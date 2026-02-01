import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { adAccounts, marketplaceProfiles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, retryWithBackoff, sleep } from '@/utils/helpers';
import { AMAZON_CONFIG, getApiBaseUrl, Marketplace } from '@/config/amazon';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface AmazonProfile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  accountInfo: {
    id: string;
    type: string;
    name: string;
    marketplaceStringId: string;
  };
}

@Injectable()
export class AmazonClientService {
  private readonly logger = new Logger(AmazonClientService.name);
  private accessTokenCache: Map<string, { token: string; expiresAt: Date }> = new Map();

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private configService: ConfigService,
  ) {}

  /**
   * Obtient un access token valide (avec cache mémoire)
   */
  async getAccessToken(adAccountId: string): Promise<string> {
    // Vérifier le cache
    const cached = this.accessTokenCache.get(adAccountId);
    if (cached && cached.expiresAt > new Date()) {
      return cached.token;
    }

    // Récupérer le refresh token de la DB
    const [account] = await this.db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, adAccountId))
      .limit(1);

    if (!account) {
      throw new Error(`Ad account ${adAccountId} not found`);
    }

    // Décrypter le refresh token
    const encryptionKey = this.configService.get<string>('security.encryptionKey')!;
    const refreshToken = decrypt(account.refreshTokenEncrypted, encryptionKey);

    // Échanger contre un access token
    const tokenResponse = await this.refreshAccessToken(refreshToken);

    // Mettre en cache (avec marge de 5 minutes)
    const expiresAt = new Date(Date.now() + (tokenResponse.expires_in - 300) * 1000);
    this.accessTokenCache.set(adAccountId, {
      token: tokenResponse.access_token,
      expiresAt,
    });

    return tokenResponse.access_token;
  }

  /**
   * Échange un refresh token contre un access token
   */
  private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const clientId = this.configService.get<string>('amazon.clientId')!;
    const clientSecret = this.configService.get<string>('amazon.clientSecret')!;

    const response = await axios.post<TokenResponse>(
      AMAZON_CONFIG.TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    return response.data;
  }

  /**
   * Crée un client HTTP configuré pour l'API Amazon Ads
   */
  async createApiClient(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
  ): Promise<AxiosInstance> {
    const accessToken = await this.getAccessToken(adAccountId);
    const clientId = this.configService.get<string>('amazon.clientId')!;
    const baseURL = getApiBaseUrl(marketplace);

    const client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': clientId,
        'Amazon-Advertising-API-Scope': profileId.toString(),
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Intercepteur pour gérer les erreurs et rate limiting
    client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          // Rate limited - attendre et retry
          const retryAfter = parseInt(error.response.headers['retry-after'] || '5', 10);
          this.logger.warn(`Rate limited, waiting ${retryAfter}s`);
          await sleep(retryAfter * 1000);
          return client.request(error.config!);
        }
        throw error;
      },
    );

    return client;
  }

  /**
   * Récupère les profils Amazon Ads pour un compte
   */
  async getProfiles(adAccountId: string): Promise<AmazonProfile[]> {
    const accessToken = await this.getAccessToken(adAccountId);
    const clientId = this.configService.get<string>('amazon.clientId')!;

    const response = await retryWithBackoff(async () => {
      return axios.get<AmazonProfile[]>(
        `${AMAZON_CONFIG.API_ENDPOINTS.EU}/v2/profiles`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': clientId,
          },
        },
      );
    });

    return response.data;
  }

  /**
   * Récupère les campagnes pour un profil
   */
  async getCampaigns(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
  ): Promise<any[]> {
    const client = await this.createApiClient(adAccountId, profileId, marketplace);

    const response = await retryWithBackoff(async () => {
      return client.post('/sp/campaigns/list', {
        stateFilter: {
          include: ['ENABLED', 'PAUSED', 'ARCHIVED'],
        },
        maxResults: 100,
      }, {
        headers: {
          Accept: AMAZON_CONFIG.API_VERSION.CAMPAIGNS,
          'Content-Type': AMAZON_CONFIG.API_VERSION.CAMPAIGNS,
        },
      });
    });

    return response.data.campaigns || [];
  }

  /**
   * Récupère les ad groups pour une campagne
   */
  async getAdGroups(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
    campaignId?: number,
  ): Promise<any[]> {
    const client = await this.createApiClient(adAccountId, profileId, marketplace);

    const body: any = {
      stateFilter: {
        include: ['ENABLED', 'PAUSED', 'ARCHIVED'],
      },
      maxResults: 100,
    };

    if (campaignId) {
      body.campaignIdFilter = { include: [campaignId.toString()] };
    }

    const response = await retryWithBackoff(async () => {
      return client.post('/sp/adGroups/list', body, {
        headers: {
          Accept: AMAZON_CONFIG.API_VERSION.AD_GROUPS,
          'Content-Type': AMAZON_CONFIG.API_VERSION.AD_GROUPS,
        },
      });
    });

    return response.data.adGroups || [];
  }

  /**
   * Récupère les keywords pour un ad group
   */
  async getKeywords(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
    adGroupId?: number,
  ): Promise<any[]> {
    const client = await this.createApiClient(adAccountId, profileId, marketplace);

    const body: any = {
      stateFilter: {
        include: ['ENABLED', 'PAUSED', 'ARCHIVED'],
      },
      maxResults: 100,
    };

    if (adGroupId) {
      body.adGroupIdFilter = { include: [adGroupId.toString()] };
    }

    const response = await retryWithBackoff(async () => {
      return client.post('/sp/keywords/list', body, {
        headers: {
          Accept: AMAZON_CONFIG.API_VERSION.KEYWORDS,
          'Content-Type': AMAZON_CONFIG.API_VERSION.KEYWORDS,
        },
      });
    });

    return response.data.keywords || [];
  }

  /**
   * Met à jour un keyword (bid, state)
   */
  async updateKeyword(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
    keywordId: number,
    updates: { bid?: number; state?: string },
  ): Promise<any> {
    const client = await this.createApiClient(adAccountId, profileId, marketplace);

    const body = {
      keywords: [
        {
          keywordId: keywordId.toString(),
          ...updates,
        },
      ],
    };

    const response = await retryWithBackoff(async () => {
      return client.put('/sp/keywords', body, {
        headers: {
          Accept: AMAZON_CONFIG.API_VERSION.KEYWORDS,
          'Content-Type': AMAZON_CONFIG.API_VERSION.KEYWORDS,
        },
      });
    });

    return response.data;
  }

  /**
   * Demande un rapport async
   */
  async requestReport(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
    reportType: string,
    startDate: string,
    endDate: string,
  ): Promise<string> {
    const client = await this.createApiClient(adAccountId, profileId, marketplace);

    const metricsMap: Record<string, string[]> = {
      campaigns: ['impressions', 'clicks', 'cost', 'sales14d', 'orders14d', 'units14d'],
      ad_groups: ['impressions', 'clicks', 'cost', 'sales14d', 'orders14d', 'units14d'],
      keywords: ['impressions', 'clicks', 'cost', 'sales14d', 'orders14d', 'units14d'],
      search_terms: ['impressions', 'clicks', 'cost', 'sales14d', 'orders14d', 'units14d', 'query'],
    };

    const body = {
      name: `${reportType}_${startDate}_${endDate}`,
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: [reportType.toUpperCase().replace('_', '')],
        columns: metricsMap[reportType] || metricsMap.campaigns,
        reportTypeId: `sp${reportType.charAt(0).toUpperCase() + reportType.slice(1)}`,
        timeUnit: 'DAILY',
        format: 'GZIP_JSON',
      },
    };

    const response = await client.post('/reporting/reports', body, {
      headers: {
        Accept: AMAZON_CONFIG.API_VERSION.REPORTS,
        'Content-Type': AMAZON_CONFIG.API_VERSION.REPORTS,
      },
    });

    return response.data.reportId;
  }

  /**
   * Vérifie le status d'un rapport
   */
  async getReportStatus(
    adAccountId: string,
    profileId: number,
    marketplace: Marketplace,
    reportId: string,
  ): Promise<{ status: string; url?: string }> {
    const client = await this.createApiClient(adAccountId, profileId, marketplace);

    const response = await client.get(`/reporting/reports/${reportId}`);

    return {
      status: response.data.status,
      url: response.data.url,
    };
  }

  /**
   * Télécharge un rapport
   */
  async downloadReport(url: string): Promise<any[]> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });

    // Décompresser et parser
    const zlib = await import('zlib');
    const decompressed = zlib.gunzipSync(response.data);
    return JSON.parse(decompressed.toString());
  }
}
