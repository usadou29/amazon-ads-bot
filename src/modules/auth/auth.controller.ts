import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  Res,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';

interface InitAuthDto {
  workspaceId: string;
  redirectUri?: string;
}

interface CallbackQueryDto {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

interface RefreshTokenDto {
  adAccountId: string;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * GET /auth/amazon
   * Initie le flux OAuth avec Amazon
   * Redirige l'utilisateur vers la page de connexion Amazon
   */
  @Get('amazon')
  initiateAuth(
    @Query('workspaceId') workspaceId: string,
    @Query('redirectUri') redirectUri: string | undefined,
    @Res() res: Response,
  ): void {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Initiating OAuth for workspace ${workspaceId}`);

    const { url } = this.authService.generateAuthUrl(workspaceId, redirectUri);

    res.redirect(HttpStatus.FOUND, url);
  }

  /**
   * POST /auth/amazon/init
   * Alternative: retourne l'URL OAuth au lieu de rediriger
   * Utile pour les SPA qui gerent la redirection cote client
   */
  @Post('amazon/init')
  initAuthJson(@Body() body: InitAuthDto): { url: string; state: string } {
    if (!body.workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Generating OAuth URL for workspace ${body.workspaceId}`);

    return this.authService.generateAuthUrl(body.workspaceId, body.redirectUri);
  }

  /**
   * GET /auth/amazon/callback
   * Callback OAuth - Amazon redirige ici apres l'authentification
   */
  @Get('amazon/callback')
  async handleCallback(
    @Query() query: CallbackQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log('Received OAuth callback');

    // Verifier si Amazon a retourne une erreur
    if (query.error) {
      this.logger.error(`OAuth error: ${query.error} - ${query.error_description}`);

      // Rediriger vers une page d'erreur frontend
      const errorUrl = `/auth/error?error=${encodeURIComponent(query.error)}&description=${encodeURIComponent(query.error_description || '')}`;
      res.redirect(HttpStatus.FOUND, errorUrl);
      return;
    }

    // Verifier les parametres requis
    if (!query.code || !query.state) {
      this.logger.error('Missing code or state in callback');
      res.redirect(HttpStatus.FOUND, '/auth/error?error=missing_parameters');
      return;
    }

    try {
      const result = await this.authService.handleCallback(query.code, query.state);

      // Rediriger vers la page de succes frontend avec l'ID du compte
      const successUrl = `/auth/success?adAccountId=${result.adAccountId}`;
      res.redirect(HttpStatus.FOUND, successUrl);
    } catch (error) {
      this.logger.error(`Callback processing failed: ${error}`);

      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      res.redirect(
        HttpStatus.FOUND,
        `/auth/error?error=callback_failed&description=${encodeURIComponent(errorMessage)}`,
      );
    }
  }

  /**
   * POST /auth/amazon/callback
   * Alternative: gestion du callback via POST pour les SPA
   * Le frontend envoie le code et state recuperes de l'URL
   */
  @Post('amazon/callback')
  async handleCallbackJson(
    @Body() body: { code: string; state: string },
  ): Promise<{ adAccountId: string; amazonAccountId: string | null }> {
    if (!body.code || !body.state) {
      throw new BadRequestException('code and state are required');
    }

    this.logger.log('Processing OAuth callback (JSON)');

    return this.authService.handleCallback(body.code, body.state);
  }

  /**
   * POST /auth/refresh
   * Rafraichit manuellement les tokens d'un ad account
   */
  @Post('refresh')
  async refreshTokens(
    @Body() body: RefreshTokenDto,
  ): Promise<{ success: boolean; expiresAt: Date }> {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    this.logger.log(`Manual token refresh requested for ad account ${body.adAccountId}`);

    return this.authService.refreshTokens(body.adAccountId);
  }

  /**
   * POST /auth/refresh/:adAccountId
   * Alternative: refresh via parametre URL
   */
  @Post('refresh/:adAccountId')
  async refreshTokensByParam(
    @Param('adAccountId') adAccountId: string,
  ): Promise<{ success: boolean; expiresAt: Date }> {
    if (!adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    this.logger.log(`Manual token refresh requested for ad account ${adAccountId}`);

    return this.authService.refreshTokens(adAccountId);
  }

  /**
   * POST /auth/revoke/:adAccountId
   * Revoque l'acces d'un ad account
   */
  @Post('revoke/:adAccountId')
  async revokeAccess(
    @Param('adAccountId') adAccountId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    this.logger.log(`Revoking access for ad account ${adAccountId}`);

    await this.authService.revokeAccess(adAccountId);

    return {
      success: true,
      message: `Access revoked for ad account ${adAccountId}`,
    };
  }
}
