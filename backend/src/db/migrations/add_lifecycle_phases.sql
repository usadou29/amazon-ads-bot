-- Migration: Ajout des phases de cycle de vie
-- Date: 2026-02-20
-- Description: Ajoute le support des phases (launch, scale, evergreen, relaunch) aux livres et règles

-- ═══════════════════════════════════════════════════════════
-- 1. Colonne phase override sur books
-- ═══════════════════════════════════════════════════════════
ALTER TABLE books ADD COLUMN IF NOT EXISTS lifecycle_phase_override VARCHAR(20);

ALTER TABLE books DROP CONSTRAINT IF EXISTS valid_lifecycle_phase;
ALTER TABLE books ADD CONSTRAINT valid_lifecycle_phase CHECK (
  lifecycle_phase_override IS NULL OR
  lifecycle_phase_override IN ('launch', 'scale', 'evergreen', 'relaunch')
);

-- ═══════════════════════════════════════════════════════════
-- 2. Colonne phases sur rules (jsonb array)
-- Les règles existantes s'appliqueront à toutes les phases par défaut
-- ═══════════════════════════════════════════════════════════
ALTER TABLE rules ADD COLUMN IF NOT EXISTS phases JSONB DEFAULT '["launch","scale","evergreen","relaunch"]';

-- Mettre à jour les règles existantes pour qu'elles aient explicitement toutes les phases
UPDATE rules SET phases = '["launch","scale","evergreen","relaunch"]' WHERE phases IS NULL;
