# NDA-Archiv — Go-Live & Bedienung

Jede Registrierung auf der PYC-Landingpage erzeugt jetzt serverseitig das signierte
NDA-PDF, legt es in Supabase ab und schreibt einen Datensatz. Der Owner sieht alle NDAs
**nach Namen sortiert** in der Analytics-Seite und kann jedes Dokument herunterladen.

## Architektur

```
/api/apply  → Redis-Lead (wie bisher)
            → archiveNda(): PDF (lib/nda-pdf.js) → Supabase Storage (Bucket "ndas", privat)
                          → Datensatz in Postgres-Tabelle "ndas"
/admin.html → Sektion "Signed NDAs" → /api/ndas (ADMIN_KEY) → Liste + Download (Signed URLs, 10 Min)
```

## Supabase-Projekt
- Name: **pyc-nda** · Region: eu-central-1 (Frankfurt) · Ref: `cjvemxtjibftsitpyqfg`
- Tabelle `public.ndas` + privater Storage-Bucket `ndas` (Migration: `supabase/migrations/0001_create_ndas.sql`)
- Zugriff nur serverseitig über den **Service-Role-Key** (RLS an, keine Policies).

## Go-Live (von Philipp auszuführen)

1. **Vercel → Project `pyc-apply` → Settings → Environment Variables** setzen:
   - `SUPABASE_URL` = `https://cjvemxtjibftsitpyqfg.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = *(Supabase → pyc-nda → Project Settings → API → `service_role` secret)*
   - `SUPABASE_NDA_BUCKET` = `ndas`
   - `ADMIN_KEY` = *(muss gesetzt sein — schaltet Analytics **und** NDA-Übersicht frei)*
2. **Deploy** (Push auf den verbundenen Branch oder Redeploy in Vercel).
3. **Funktionstest:** Eine Testregistrierung absenden → in Supabase prüfen, dass eine PDF im Bucket
   `ndas` liegt und eine Zeile in Tabelle `ndas` steht. Dann `https://<domain>/admin.html` öffnen,
   mit `ADMIN_KEY` einloggen → Sektion „Signed NDAs" zeigt den Eintrag, Download liefert das PDF.

## Altfälle nachtragen (einmalig, nach dem Deploy)

Bestehende Registrierungen liegen nur als Redis-Lead vor (ohne PDF). Der Backfill erzeugt daraus
rückwirkend PDFs + Datensätze. Idempotent (mehrfach ausführbar, bereits vorhandene werden übersprungen):

```bash
curl -X POST "https://<domain>/api/admin/backfill-ndas" -H "x-admin-key: <ADMIN_KEY>"
```

Antwort z. B.: `{ "ok": true, "totalLeads": 12, "processed": 12, "skipped": 0, "failed": 0 }`.
Das Signatur-Datum der Altfälle wird aus dem ursprünglichen `submittedAt` übernommen.

## Hinweise
- `archiveNda()` ist non-blocking: schlägt Supabase fehl, läuft die Registrierung + E-Mail trotzdem durch
  (nur Log-Eintrag). Das Archiv blockiert nie das Kerngeschäft.
- DSGVO: personenbezogene Daten, EU-Region, privater Bucket, Download nur über kurzlebige Signed URLs.
