-- Events: tech conferences and meetups from approved sources (final state of
-- platform migration 0049 for this table). Idempotent.

CREATE TABLE IF NOT EXISTS public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    time_zone text,
    all_day boolean DEFAULT true NOT NULL,
    format text NOT NULL,
    country text,
    city text,
    url text NOT NULL,
    cfp_url text,
    cfp_ends_at timestamp with time zone,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    kind text DEFAULT 'conference'::text NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_cfp_url_check CHECK (((cfp_url IS NULL) OR (cfp_url ~ '^https?://'::text))),
    CONSTRAINT events_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT events_dates_check CHECK ((ends_at >= starts_at)),
    CONSTRAINT events_format_check CHECK ((format = ANY (ARRAY['online'::text, 'offline'::text, 'hybrid'::text]))),
    CONSTRAINT events_kind_check CHECK ((kind = ANY (ARRAY['summit'::text, 'conference'::text, 'meetup'::text, 'hackathon'::text, 'business'::text, 'career'::text]))),
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['published'::text, 'removed'::text, 'expired'::text]))),
    CONSTRAINT events_url_check CHECK ((url ~ '^https?://'::text))
);

ALTER TABLE ONLY public.events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_pkey') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_slug_key') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_slug_key UNIQUE (slug);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_source_external_key') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_source_external_key UNIQUE (source, external_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS events_source_seen_idx ON public.events USING btree (source, last_seen_at);

CREATE INDEX IF NOT EXISTS events_status_starts_idx ON public.events USING btree (status, starts_at);

CREATE INDEX IF NOT EXISTS events_topics_idx ON public.events USING gin (topics);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'events_anon_deny') THEN
    CREATE POLICY events_anon_deny ON public.events TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'events_app_rw_all') THEN
    CREATE POLICY events_app_rw_all ON public.events TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'events_authenticated_deny') THEN
    CREATE POLICY events_authenticated_deny ON public.events TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

-- Table rights for the app role, as on the platform.
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.events TO app_rw;
