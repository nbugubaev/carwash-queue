-- SQL Schema for Car Wash Queue Management System
-- Run this in your Supabase SQL Editor (https://supabase.com)

-- 1. DROP EXISTING TABLES (IF ANY) - FOR CLEAN SETUP
DROP TABLE IF EXISTS public.queue CASCADE;
DROP TABLE IF EXISTS public.businesses CASCADE;

-- 2. CREATE BUSINESSES TABLE
CREATE TABLE public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    boxes_count INTEGER DEFAULT 4 NOT NULL CHECK (boxes_count > 0 AND boxes_count <= 20),
    base_wash_time INTEGER DEFAULT 30 NOT NULL CHECK (base_wash_time > 0 AND base_wash_time <= 180),
    offline_boxes INTEGER[] DEFAULT '{}'::integer[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. CREATE QUEUE TABLE
CREATE TABLE public.queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    plate_number TEXT NOT NULL,
    phone_number TEXT,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_box', 'completed', 'cancelled')),
    box_number INTEGER,
    presence_confirmed BOOLEAN DEFAULT FALSE NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    invited_at TIMESTAMP WITH TIME ZONE, -- when the customer is asked to confirm presence (within top 2)
    started_at TIMESTAMP WITH TIME ZONE, -- when they enter the box
    completed_at TIMESTAMP WITH TIME ZONE, -- when the operator marks wash as complete
    cancelled_at TIMESTAMP WITH TIME ZONE, -- when customer leaves queue or times out
    created_by TEXT DEFAULT 'client' CHECK (created_by IN ('client', 'operator')) NOT NULL
);

-- 4. ENABLE ROW LEVEL SECURITY (RLS)
-- To keep the MVP simple, we will allow public read and write access on businesses and queue.
-- In production, policies should restrict operations by user auth.
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue ENABLE ROW LEVEL SECURITY;

-- 5. CREATE SECURITY POLICIES (ALL ALLOWED FOR MVP RUNNING ON VERCEL & CLIENTS)
CREATE POLICY "Allow public read businesses" ON public.businesses
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert/update businesses" ON public.businesses
    FOR ALL USING (true);

CREATE POLICY "Allow public read queue" ON public.queue
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert queue" ON public.queue
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update queue" ON public.queue
    FOR UPDATE USING (true);

CREATE POLICY "Allow public delete queue" ON public.queue
    FOR DELETE USING (true);

-- 6. ENABLE SUPABASE REALTIME REPLICATION FOR ACTIVE SYNCING
-- This is critical for clients and operators to see queue updates instantly.
-- In Supabase dashboard, you can also enable this by going to Database -> Replication.
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.businesses;
