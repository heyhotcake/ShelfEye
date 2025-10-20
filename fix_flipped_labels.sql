-- Fix flipped tool names in slots table
-- Swap "pen" and "5x5" labels

UPDATE slots 
SET tool_name = CASE 
  WHEN tool_name = 'pen' THEN '5x5'
  WHEN tool_name = '5x5' THEN 'pen'
  ELSE tool_name
END
WHERE camera_id = '77fa17c2-5109-43ed-8f43-b0b1aec5703f'
  AND tool_name IN ('pen', '5x5');
