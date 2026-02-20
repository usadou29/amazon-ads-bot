-- Migration: Ajout des champs redevance à la table books
-- Date: 2026-02-20
-- Description: Permet aux auteurs de saisir leur taux de redevance KDP
--              Soit en pourcentage, soit via prix de vente + redevance par livre
--              Si absent, le frontend estimera à 25% (division par 4)

ALTER TABLE books
ADD COLUMN IF NOT EXISTS royalty_rate DECIMAL(5, 2);

ALTER TABLE books
ADD COLUMN IF NOT EXISTS sale_price DECIMAL(10, 2);

ALTER TABLE books
ADD COLUMN IF NOT EXISTS royalty_per_unit DECIMAL(10, 2);

COMMENT ON COLUMN books.royalty_rate IS 'Taux de redevance KDP en pourcentage (ex: 35.00 ou 70.00). NULL = estimation à 25%';
COMMENT ON COLUMN books.sale_price IS 'Prix de vente du livre en euros (ex: 12.99). Utilisé pour calculer le taux de redevance précis';
COMMENT ON COLUMN books.royalty_per_unit IS 'Redevance en euros par livre vendu (ex: 3.33). Utilisé avec sale_price pour calculer le taux';
