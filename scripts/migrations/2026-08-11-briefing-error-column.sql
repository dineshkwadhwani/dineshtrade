-- Add error column to platform_daily_briefing for privileged error visibility

ALTER TABLE platform_daily_briefing 
ADD COLUMN error TEXT;
