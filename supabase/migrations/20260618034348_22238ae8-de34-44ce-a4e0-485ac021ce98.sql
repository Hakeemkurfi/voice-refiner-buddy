
-- ============================================================
-- 1. BURSTS
-- ============================================================
CREATE TABLE public.bursts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   text,
  status      text NOT NULL DEFAULT 'capturing', -- capturing | ready | analyzed | failed
  frame_count int  NOT NULL DEFAULT 0,
  picked_seqs int[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bursts TO service_role;
ALTER TABLE public.bursts ENABLE ROW LEVEL SECURITY;
-- no anon/authenticated policies: only service_role (server fns) may touch this table

CREATE TABLE public.burst_frames (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  burst_id   uuid NOT NULL REFERENCES public.bursts(id) ON DELETE CASCADE,
  seq        int  NOT NULL,
  image_b64  text NOT NULL,
  sharpness  double precision,
  byte_size  int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (burst_id, seq)
);
CREATE INDEX burst_frames_burst_id_idx ON public.burst_frames(burst_id);
GRANT ALL ON public.burst_frames TO service_role;
ALTER TABLE public.burst_frames ENABLE ROW LEVEL SECURITY;

-- update_at trigger for bursts
CREATE OR REPLACE FUNCTION public.tg_bursts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER bursts_updated_at
BEFORE UPDATE ON public.bursts
FOR EACH ROW EXECUTE FUNCTION public.tg_bursts_updated_at();

-- ============================================================
-- 2. SECURITY FIX — events table
-- ============================================================
-- Drop the permissive public SELECT policy. Web UI will read via a server fn.
DROP POLICY IF EXISTS "Anyone can read events" ON public.events;

-- Make sure the table is NOT in the realtime publication
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.events';
  END IF;
END $$;

-- Revoke any direct grants from anon/authenticated; only service_role reads now
REVOKE ALL ON public.events FROM anon, authenticated;
GRANT ALL ON public.events TO service_role;
