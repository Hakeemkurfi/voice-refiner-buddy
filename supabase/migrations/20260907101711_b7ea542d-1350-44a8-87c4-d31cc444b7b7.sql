REVOKE SELECT ON public.neuro_state FROM anon;

DROP POLICY IF EXISTS "Neuro state is publicly readable" ON public.neuro_state;

CREATE POLICY "Authenticated users can read neuro state"
ON public.neuro_state FOR SELECT
TO authenticated
USING (true);