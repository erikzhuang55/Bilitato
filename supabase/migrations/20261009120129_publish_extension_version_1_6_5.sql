insert into public.extension_versions (
  id,
  latest_version,
  release_url,
  enabled,
  updated_at
)
values (
  'bilitato',
  '1.6.5',
  'https://github.com/erikzhuang55/Bilitato/releases/tag/v1.6.5',
  true,
  now()
)
on conflict (id) do update
set latest_version = excluded.latest_version,
    release_url = excluded.release_url,
    enabled = excluded.enabled,
    updated_at = now();
