CREATE SEQUENCE public.pi_event_cursor_seq;

CREATE TABLE public.pi_devices (
  device_id text PRIMARY KEY,
  capture_seq bigint NOT NULL DEFAULT 0,
  token_hash text,
  paired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pi_devices TO service_role;
ALTER TABLE public.pi_devices ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pi_answers (
  question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  capture_sequence bigint NOT NULL,
  capture_token text NOT NULL,
  boot_session_id text,
  revision integer NOT NULL DEFAULT 0,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  voice text,
  title text,
  status text NOT NULL DEFAULT 'capturing',
  error text,
  event_cursor bigint NOT NULL DEFAULT nextval('public.pi_event_cursor_seq'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pi_answers_device_cursor ON public.pi_answers(device_id, event_cursor);
GRANT ALL ON public.pi_answers TO service_role;
ALTER TABLE public.pi_answers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_pi_answers_cursor() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.event_cursor := nextval('public.pi_event_cursor_seq');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER pi_answers_cursor BEFORE UPDATE ON public.pi_answers FOR EACH ROW EXECUTE FUNCTION public.tg_pi_answers_cursor();

CREATE TABLE public.pi_pair_codes (
  code_hash text PRIMARY KEY,
  device_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pi_pair_codes TO service_role;
ALTER TABLE public.pi_pair_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pi_commands (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL,
  question_id uuid,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pi_commands TO service_role;
GRANT USAGE ON SEQUENCE public.pi_commands_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.pi_event_cursor_seq TO service_role;
ALTER TABLE public.pi_commands ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pi_next_capture(_device text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s bigint;
BEGIN
  INSERT INTO public.pi_devices(device_id, capture_seq) VALUES (_device, 1)
  ON CONFLICT (device_id) DO UPDATE SET capture_seq = public.pi_devices.capture_seq + 1
  RETURNING capture_seq INTO s;
  UPDATE public.pi_answers SET status = 'superseded'
   WHERE device_id = _device AND capture_sequence < s AND status IN ('capturing','ready');
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.pi_next_capture(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_next_capture(text) TO service_role;