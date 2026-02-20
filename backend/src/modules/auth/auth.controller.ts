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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
   * Callback OAuth - Amazon redirige ici apres l'authentification.
   * Répond avec une page HTML (succès ou erreur), sans secret.
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
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(this.renderAuthErrorPage(query.error, query.error_description || ''));
      return;
    }

    // Verifier les parametres requis
    if (!query.code || !query.state) {
      this.logger.error('Missing code or state in callback');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(this.renderAuthErrorPage('missing_parameters', 'Code ou state manquant dans le callback.'));
      return;
    }

    try {
      const result = await this.authService.handleCallback(query.code, query.state);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(this.renderAuthSuccessPage(result.adAccountId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      this.logger.error(`Callback processing failed: ${errorMessage}`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(401).send(this.renderAuthErrorPage('callback_failed', errorMessage));
    }
  }

  /**
   * Page HTML succès (local dev friendly) — aucun secret.
   */
  private renderAuthSuccessPage(adAccountId: string): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Auth Amazon — Succès</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #0a0; }
    code { background: #eee; padding: 0.2em 0.4em; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Succès</h1>
  <p>Connexion Amazon Ads effectuée. Compte créé ou mis à jour.</p>
  <p><strong>Ad account ID :</strong> <code>${escapeHtml(adAccountId)}</code></p>
  <p>Aucun secret n’est affiché. Vérifiez en base que <code>ad_accounts.refresh_token_encrypted</code> est renseigné.</p>
</body>
</html>`;
  }

  /**
   * Page HTML erreur (local dev friendly) — message clair, aucun secret.
   */
  private renderAuthErrorPage(errorCode: string, description: string): string {
    const safeCode = escapeHtml(errorCode);
    const safeDesc = escapeHtml(description);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Auth Amazon — Erreur</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #c00; }
    code { background: #fee; padding: 0.2em 0.4em; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Erreur d’authentification</h1>
  <p><strong>Code :</strong> <code>${safeCode}</code></p>
  <p>${safeDesc}</p>
</body>
</html>`;
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
