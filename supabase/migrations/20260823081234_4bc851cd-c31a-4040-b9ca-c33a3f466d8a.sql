CREATE TABLE public.neuro_state (
  id text PRIMARY KEY,
  device_id text,
  emotion text NOT NULL DEFAULT 'rest',
  intensity real NOT NULL DEFAULT 0.5,
  bulb boolean NOT NULL DEFAULT false,
  eeg jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.neuro_state TO anon;
GRANT SELECT ON public.neuro_state TO authenticated;
GRANT ALL ON public.neuro_state TO service_role;

ALTER TABLE public.neuro_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Neuro state is publicly readable"
ON public.neuro_state FOR SELECT
USING (true);

INSERT INTO public.neuro_state (id, device_id, emotion, intensity, bulb)
VALUES ('default', 'esp32-neuro-01', 'rest', 0.4, false);