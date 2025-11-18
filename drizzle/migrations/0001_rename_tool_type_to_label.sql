-- Migration: Rename tool_type to label in tool_categories table
-- This allows better semantic naming for display labels that support Japanese text

BEGIN;

ALTER TABLE tool_categories 
RENAME COLUMN tool_type TO label;

COMMIT;
