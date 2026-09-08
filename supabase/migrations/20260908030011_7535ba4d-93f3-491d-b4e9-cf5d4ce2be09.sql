
revoke all on function public.match_resource_chunks(vector, integer, text, double precision) from public, anon, authenticated;
grant execute on function public.match_resource_chunks(vector, integer, text, double precision) to service_role;
