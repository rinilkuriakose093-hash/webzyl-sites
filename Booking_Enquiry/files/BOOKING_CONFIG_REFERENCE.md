# Booking System Configuration Reference

**Known-Good State** (Frozen Contract)  
*Last verified: December 24, 2025*

---

## Core Integration Points

### 1. Worker URL
```
https://webzyl-worker.rinil-kuriakose093.workers.dev
```

### 2. Apps Script Web App URL
```
https://script.google.com/macros/s/AKfycbz0kaAj9KE7WxvShDAQOaCy54h4fGFv53ziwnFyz62XpitCmzUx1xfYTsyzPBtKBQ/exec
```

### 3. Spreadsheet ID
```
13KtqdfeP2EPQl4IY_KtKcXHqqn5wLJNT9QgL7f0p2Pc
```

---

## Integration Flow

```
Browser → Worker (/api/booking)
         ↓
    Validation + Rate Limiting
         ↓
    Apps Script Web App
         ↓
    Google Sheets (Spreadsheet ID above)
```

---

**Note:** These three values together define the frozen contract for the booking system. Do not modify without documenting the change.
