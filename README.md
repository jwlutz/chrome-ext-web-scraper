# Yoink.ai

**Free and open source web scraping Chrome extension.** Extract structured data from any webpage into spreadsheets with just a few clicks.

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/yoinkai/afmmfhkdbnebcpidjfgjpkblmocpmbmm)

## Features

- **Auto-detect repeating elements** - Automatically finds products, listings, tables, and other repeating patterns on any page
- **Manual selection mode** - Click any element to select similar items across the page
- **Multiple export formats** - Export to CSV, XLSX, JSON, or copy to clipboard
- **Works on any website** - Amazon, LinkedIn, news sites, directories, and more
- **Shadow DOM isolation** - UI won't break regardless of page styles
- **100% free and open source** - No accounts, no limits, no tracking

## Installation

### Chrome Web Store (Recommended)

[**Install Yoink.ai from Chrome Web Store**](https://chromewebstore.google.com/detail/yoinkai/afmmfhkdbnebcpidjfgjpkblmocpmbmm)

### Manual Installation (Developer)

1. Clone this repository
2. Run `npm install` and `npm run build` in `dev_build/`
3. Go to `chrome://extensions`
4. Enable "Developer mode"
5. Click "Load unpacked" and select `dev_build/dist/`

## How to Use

1. **Navigate** to any webpage with data you want to extract
2. **Click** the Yoink.ai extension icon in your toolbar
3. **Auto-detect** will automatically find repeating elements, or use **Manual Selection** to click specific elements
4. **Preview** the extracted data in the table view
5. **Export** to your preferred format (CSV, XLSX, JSON, or clipboard)

## Use Cases

- Scrape product listings from e-commerce sites
- Extract job postings from job boards
- Collect article headlines from news sites
- Gather contact information from directories
- Export table data from any webpage

## Development

```bash
cd dev_build
npm install
npm run build
```

## License

MIT License - feel free to use, modify, and distribute.

---

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/yoinkai/afmmfhkdbnebcpidjfgjpkblmocpmbmm)**
