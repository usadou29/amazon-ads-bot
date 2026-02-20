import { Injectable, Inject, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { adAccounts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '@/utils/helpers';
import { AMAZON_CONFIG } from '@/config/amazon';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface OAuthState {
  workspaceId: string;
  redirectUri: string;
  timestamp: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Cache temporaire des states OAuth (en production, utiliser Redis)
  private oauthStateCache: Map<string, OAuthState> = new Map();
  private readonly STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private configService: ConfigService,
  ) {
    // Nettoyer les states expirés périodiquement
    setInterval(() => this.cleanupExpiredStates(), 60000);
  }

  /**
   * Genere l'URL OAuth Amazon pour l'authentification
   */
  generateAuthUrl(workspaceId: string, redirectUri?: string): { url: string; state: string } {
    const clientId = this.configService.get<string>('amazon.clientId');
    const defaultRedirectUri = this.configService.get<string>('amazon.redirectUri');

    if (!clientId) {
      throw new BadRequestException('Amazon Client ID not configured');
    }

    const finalRedirectUri = redirectUri || defaultRedirectUri;
    if (!finalRedirectUri) {
      throw new BadRequestException('Redirect URI not configured');
    }

    // Generer un state unique pour la securite CSRF
    const state = this.generateState();

    // Stocker le state avec les metadonnees
    this.oauthStateCache.set(state, {
      workspaceId,
      redirectUri: finalRedirectUri,
      timestamp: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: clientId,
      scope: AMAZON_CONFIG.OAUTH_SCOPES.join(' '),
      response_type: 'code',
      redirect_uri: finalRedirectUri,
      state,
    });

    const url = `${AMAZON_CONFIG.AUTH_URL}?${params.toString()}`;

    this.logger.log(`Generated OAuth URL for workspace ${workspaceId}`);

    return { url, state };
  }

  /**
   * Gere le callback OAuth et echange le code contre des tokens
   */
  async handleCallback(code: string, state: string): Promise<{
    adAccountId: string;
    amazonAccountId: string | null;
  }> {
    // Valider le state
    const stateData = this.oauthStateCache.get(state);
    if (!stateData) {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }

    // Verifier l'expiration
    if (Date.now() - stateData.timestamp > this.STATE_TTL_MS) {
      this.oauthStateCache.delete(state);
      throw new UnauthorizedException('OAuth state expired');
    }

    // Supprimer le state utilise
    this.oauthStateCache.delete(state);

    try {
      // Echanger le code contre des tokens
      const tokenResponse = await this.exchangeCodeForTokens(code, stateData.redirectUri);

      // Chiffrer le refresh token
      const encryptionKey = this.configService.get<string>('security.encryptionKey')!;
      const refreshTokenEncrypted = encrypt(tokenResponse.refresh_token, encryptionKey);

      // Calculer la date d'expiration du token
      const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

      // Recuperer les informations du compte Amazon
      const accountInfo = await this.getAccountInfo(tokenResponse.access_token);

      // Creer l'ad account (refresh_token stocke chiffre, access_token jamais en DB)
      const [adAccount] = await this.db
        .insert(adAccounts)
        .values({
          workspaceId: stateData.workspaceId,
          refreshTokenEncrypted,
          tokenExpiresAt,
          amazonAccountId: accountInfo?.id || null,
          accountName: accountInfo?.name || null,
          status: 'active',
        })
        .returning();

      this.logger.log(`Successfully authenticated ad account ${adAccount.id} for workspace ${stateData.workspaceId}`);

      return {
        adAccountId: adAccount.id,
        amazonAccountId: accountInfo?.id || null,
      };
    } catch (error) {
      this.logger.error(`OAuth callback failed: ${error}`);
      throw new UnauthorizedException('Failed to complete OAuth authentication');
    }
  }

  /**
   * Rafraichit manuellement les tokens d'un ad account
   */
  async refreshTokens(adAccountId: string): Promise<{
    success: boolean;
    expiresAt: Date;
  }> {
    // Recuperer l'ad account
    const [account] = await this.db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, adAccountId))
      .limit(1);

    if (!account) {
      throw new BadRequestException(`Ad account ${adAccountId} not found`);
    }

    try {
      // Dechiffrer le refresh token actuel
      const encryptionKey = this.configService.get<string>('security.encryptionKey')!;
      const refreshToken = decrypt(account.refreshTokenEncrypted, encryptionKey);

      // Obtenir de nouveaux tokens
      const tokenResponse = await this.refreshAccessToken(refreshToken);

      // Chiffrer le nouveau refresh token (Amazon peut en renvoyer un nouveau)
      const newRefreshTokenEncrypted = encrypt(tokenResponse.refresh_token, encryptionKey);
      const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

      // Mettre a jour la DB
      await this.db
        .update(adAccounts)
        .set({
          refreshTokenEncrypted: newRefreshTokenEncrypted,
          tokenExpiresAt,
          status: 'active',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(adAccounts.id, adAccountId));

      this.logger.log(`Successfully refreshed tokens for ad account ${adAccountId}`);

      return {
        success: true,
        expiresAt: tokenExpiresAt,
      };
    } catch (error) {
      // Marquer le compte en erreur
      const errorMessage = error instanceof Error ? error.message : 'Token refresh failed';
      await this.db
        .update(adAccounts)
        .set({
          status: 'error',
          lastError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(adAccounts.id, adAccountId));

      this.logger.error(`Failed to refresh tokens for ad account ${adAccountId}: ${error}`);
      throw new UnauthorizedException('Failed to refresh tokens');
    }
  }

  /**
   * Revoque l'acces d'un ad account
   */
  async revokeAccess(adAccountId: string): Promise<void> {
    await this.db
      .update(adAccounts)
      .set({
        status: 'revoked',
        lastError: 'Access manually revoked',
        updatedAt: new Date(),
      })
      .where(eq(adAccounts.id, adAccountId));

    this.logger.log(`Revoked access for ad account ${adAccountId}`);
  }

  /**
   * Echange le code d'autorisation contre des tokens
   */
  private async exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
    const clientId = this.configService.get<string>('amazon.clientId')!;
    const clientSecret = this.configService.get<string>('amazon.clientSecret')!;

    const response = await axios.post<TokenResponse>(
      AMAZON_CONFIG.TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
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
   * Rafraichit un access token
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
   * Recupere les informations du compte Amazon
   */
  private async getAccountInfo(accessToken: string): Promise<{ id: string; name: string } | null> {
    try {
      const clientId = this.configService.get<string>('amazon.clientId')!;

      // Utiliser l'endpoint profiles pour obtenir les infos du compte
      const response = await axios.get(`${AMAZON_CONFIG.API_ENDPOINTS.EU}/v2/profiles`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': clientId,
        },
      });

      const profiles = response.data;
      if (profiles.length > 0) {
        const firstProfile = profiles[0];
        return {
          id: firstProfile.accountInfo?.id || firstProfile.profileId?.toString(),
          name: firstProfile.accountInfo?.name || 'Amazon Ads Account',
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to get account info: ${error}`);
      return null;
    }
  }

  /**
   * Genere un state aleatoire securise
   */
  private generateState(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Nettoie les states OAuth expires
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of this.oauthStateCache.entries()) {
      if (now - data.timestamp > this.STATE_TTL_MS) {
        this.oauthStateCache.delete(state);
      }
    }
  }
}
