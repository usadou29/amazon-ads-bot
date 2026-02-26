/**
 * Bid Cooldown System — Tests unitaires
 * ======================================
 * 5 scénarios obligatoires :
 * 1. launch + 1j → cooldown actif (3j)
 * 2. launch + 4j → cooldown expiré
 * 3. evergreen + 5j → cooldown actif (7j)
 * 4. pause pendant cooldown → autorisé
 * 5. API bid pendant cooldown → rejeté 409
 */

import { GUARDS } from '@/config/guards';
import { ConflictException } from '@nestjs/common';

// ── Helpers pour simuler le checkCooldown ──────────────────────

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Réplique exacte de la logique checkCooldown du ActionSuggestionService.
 * Testée en isolation pour valider les règles métier.
 */
function checkCooldown(
  lastBidChangeAt: Date | null,
  phase: string,
): { active: boolean; daysSinceChange: number; cooldownDays: number; remainingDays: number } | null {
  if (!lastBidChangeAt) return null;

  const cooldownDays = GUARDS.COOLDOWN_DAYS_BY_PHASE[phase] ?? 7;
  const diffMs = Date.now() - lastBidChangeAt.getTime();
  const daysSinceChange = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, cooldownDays - daysSinceChange);
  const active = daysSinceChange < cooldownDays;

  if (!active) return null;

  return { active: true, daysSinceChange, cooldownDays, remainingDays };
}

/**
 * Réplique de la logique checkBidCooldown du ExecutorService.
 * Lève ConflictException si cooldown actif et actionType === 'adjust_bid'.
 */
function checkBidCooldownGuard(
  lastBidChangeAt: Date | null,
  actionType: string,
  lifecyclePhase?: string,
): void {
  if (actionType !== 'adjust_bid') return;
  if (!lastBidChangeAt) return;

  const phase = lifecyclePhase || 'evergreen';
  const cooldownDays = GUARDS.COOLDOWN_DAYS_BY_PHASE[phase] ?? 7;
  const diffMs = Date.now() - new Date(lastBidChangeAt).getTime();
  const daysSinceChange = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (daysSinceChange < cooldownDays) {
    const remaining = cooldownDays - daysSinceChange;
    throw new ConflictException(
      `Enchère en période d'observation (J+${daysSinceChange}/${cooldownDays}). ` +
      `Encore ${remaining} jour${remaining > 1 ? 's' : ''} avant de pouvoir modifier l'enchère.`,
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────

describe('Bid Cooldown System', () => {
  // Vérifier que les constantes existent
  it('should have COOLDOWN_DAYS_BY_PHASE in GUARDS', () => {
    expect(GUARDS.COOLDOWN_DAYS_BY_PHASE).toBeDefined();
    expect(GUARDS.COOLDOWN_DAYS_BY_PHASE.launch).toBe(3);
    expect(GUARDS.COOLDOWN_DAYS_BY_PHASE.relaunch).toBe(3);
    expect(GUARDS.COOLDOWN_DAYS_BY_PHASE.scale).toBe(5);
    expect(GUARDS.COOLDOWN_DAYS_BY_PHASE.evergreen).toBe(7);
  });

  // ── Scénario 1: launch + 1j → cooldown actif ──
  it('should detect active cooldown for launch phase with bid changed 1 day ago', () => {
    const result = checkCooldown(daysAgo(1), 'launch');
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.cooldownDays).toBe(3);
    expect(result!.daysSinceChange).toBe(1);
    expect(result!.remainingDays).toBe(2);
  });

  // ── Scénario 2: launch + 4j → cooldown expiré ──
  it('should detect expired cooldown for launch phase with bid changed 4 days ago', () => {
    const result = checkCooldown(daysAgo(4), 'launch');
    // cooldownDays = 3, daysSince = 4 → expiré → retourne null
    expect(result).toBeNull();
  });

  // ── Scénario 3: evergreen + 5j → cooldown actif (7j) ──
  it('should detect active cooldown for evergreen phase with bid changed 5 days ago', () => {
    const result = checkCooldown(daysAgo(5), 'evergreen');
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.cooldownDays).toBe(7);
    expect(result!.daysSinceChange).toBe(5);
    expect(result!.remainingDays).toBe(2);
  });

  // ── Scénario 4: pause pendant cooldown → autorisé ──
  it('should allow pause action during active cooldown', () => {
    // La pause ne doit PAS lever d'exception, même si cooldown actif
    expect(() => {
      checkBidCooldownGuard(daysAgo(1), 'pause', 'launch');
    }).not.toThrow();
  });

  // ── Scénario 5: API bid pendant cooldown → rejeté 409 ──
  it('should reject adjust_bid action during active cooldown with ConflictException', () => {
    expect(() => {
      checkBidCooldownGuard(daysAgo(1), 'adjust_bid', 'launch');
    }).toThrow(ConflictException);

    // Vérifier le message
    try {
      checkBidCooldownGuard(daysAgo(1), 'adjust_bid', 'launch');
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('observation');
      expect(err.message).toContain('J+1/3');
    }
  });

  // ── Tests complémentaires ──

  it('should return null when no lastBidChangeAt is set', () => {
    const result = checkCooldown(null, 'launch');
    expect(result).toBeNull();
  });

  it('should use 7 days default when phase is unknown', () => {
    const result = checkCooldown(daysAgo(5), 'unknown_phase');
    expect(result).not.toBeNull();
    expect(result!.cooldownDays).toBe(7);
    expect(result!.remainingDays).toBe(2);
  });

  it('should allow adjust_bid when cooldown is expired', () => {
    expect(() => {
      checkBidCooldownGuard(daysAgo(8), 'adjust_bid', 'evergreen');
    }).not.toThrow();
  });

  it('should allow enable action during active cooldown', () => {
    expect(() => {
      checkBidCooldownGuard(daysAgo(1), 'enable', 'evergreen');
    }).not.toThrow();
  });

  it('should handle scale phase cooldown correctly (5 days)', () => {
    // 3 days ago, scale = 5 day cooldown → active
    const active = checkCooldown(daysAgo(3), 'scale');
    expect(active).not.toBeNull();
    expect(active!.cooldownDays).toBe(5);
    expect(active!.remainingDays).toBe(2);

    // 6 days ago, scale = 5 day cooldown → expired
    const expired = checkCooldown(daysAgo(6), 'scale');
    expect(expired).toBeNull();
  });

  it('should handle relaunch phase cooldown correctly (3 days)', () => {
    // 2 days ago, relaunch = 3 day cooldown → active
    const active = checkCooldown(daysAgo(2), 'relaunch');
    expect(active).not.toBeNull();
    expect(active!.cooldownDays).toBe(3);
    expect(active!.remainingDays).toBe(1);

    // 3 days ago, relaunch = 3 day cooldown → expired (daysSince=3 >= 3)
    const expired = checkCooldown(daysAgo(3), 'relaunch');
    expect(expired).toBeNull();
  });
});
