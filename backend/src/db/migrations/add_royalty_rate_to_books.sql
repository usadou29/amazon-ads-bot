-- Migration: Ajout du champ royalty_rate à la table books
-- Date: 2026-02-20
-- Description: Permet aux auteurs de saisir leur taux de redevance KDP
--              Si absent, le frontend estimera à 25% (division par 4)

ALTER TABLE books
ADD COLUMN IF NOT EXISTS royalty_rate DECIMAL(5, 2);

COMMENT ON COLUMN books.royalty_rate IS 'Taux de redevance KDP en pourcentage (ex: 35.00 ou 70.00). NULL = estimation à 25%';
