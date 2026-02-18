# Prototipe Pelaporan Kegiatan Triwulan - Balikpapan

Prototype mobile-first untuk alur pelaporan perencanaan dan progress kegiatan dari **Kelompok Pelapor → Verifikator KPH → Balai PS**.

## Fitur Utama
- Login/sign up multi-role: Pelapor, Verifikator, Balai, Admin.
- Form laporan triwulan lengkap (dokumen perencanaan + PoA + progress + catatan tahunan).
- Workflow status: `DRAFT → SUBMITTED/UNDER_REVIEW → APPROVED/REJECTED → REVISED → FINAL_SENT` + audit trail.
- Upload lampiran foto/dokumen (metadata prototype + preview list).
- Pemilihan lokasi berbasis peta (OpenStreetMap + Leaflet) dibatasi area Balikpapan.
- Dashboard ringkas (kartu KPI per status + grafik tren).
- Export PDF laporan.
- Simulasi notifikasi email + tombol reminder.
- Offline mode minimum: simpan draft lokal dan sinkronisasi manual saat online.

## Menjalankan
Karena ini aplikasi statis:

```bash
python3 -m http.server 4173
```

Lalu buka `http://localhost:4173`.

## Catatan Prototipe
- Notifikasi email disimulasikan sebagai log notifikasi dalam aplikasi.
- Upload file disimpan sebagai metadata browser (nama/ukuran/tipe), bukan backend storage.
- Data disimpan di `localStorage` browser.
