DROP POLICY IF EXISTS "Authenticated users can read neuro state" ON public.neuro_state;
REVOKE SELECT ON public.neuro_state FROM authenticated, anon;
GRANT ALL ON public.neuro_state TO service_role;