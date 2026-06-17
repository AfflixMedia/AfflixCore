-- =========================================================
-- Afflix Core — Paid Collab Handler Client Access
--
-- This migration adds a `client_id` to `handler_collab_brands`
-- and grants read-only access to users with that `client_id`.
-- This allows Paid Collab Clients to view the Handler's 
-- workspace data without being able to edit it.
-- =========================================================

-- 1. Add client_id to handler_collab_brands
ALTER TABLE public.handler_collab_brands
ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. Client Read Policies

-- A Client can read a brand if they are assigned to it
CREATE POLICY handler_collab_brands_client_select ON public.handler_collab_brands
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

-- A Client can read a brand month if they are assigned to the brand
CREATE POLICY handler_collab_brand_months_client_select ON public.handler_collab_brand_months
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.handler_collab_brands
    WHERE id = handler_collab_brand_months.brand_id AND client_id = auth.uid()
  ));

-- A Client can read creators if they are assigned to the brand
CREATE POLICY handler_collab_creators_client_select ON public.handler_collab_creators
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.handler_collab_brands
    WHERE id = handler_collab_creators.brand_id AND client_id = auth.uid()
  ));
