-- Migration: add cover_image_url to books
-- Allows storing an external URL for the book cover image (e.g. Amazon media URL)
ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
