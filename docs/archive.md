# MAX seat archive

The SNCF feed only shows today's MAX seats. The **Archive MAX seats** workflow saves one
snapshot a day on the public `data` branch, so seat odds (by weekday, departure time and
days before travel) can be computed from the history.

- Path: `archive/max/YYYY/YYYY-MM-DD.json.gz`, named by the day the feed was read (UTC).
  A day already archived is never overwritten.
- Content (gzipped JSON):

```json
{
  "snapshot": "2026-10-05",
  "start": "2026-10-05",
  "days": 31,
  "services": [["PARIS (intramuros)", "LYON (intramuros)", "6601", "08:00", "11.0..."]]
}
```

Each service (origin, destination, train number, departure) is stored once. Its last field
has one character per day from `start`: `1` a free MAX seat, `0` no MAX seat, `.` not
running that day.

Data: SNCF Open Data, Licence Ouverte.
