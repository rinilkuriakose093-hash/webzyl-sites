# Quick Start Guide - Resort Website

## 🚀 Get Started in 30 Seconds

### 1. View Your Website
Open `template4.html` in your web browser:
- All features are **enabled by default**
- Shows complete resort website
- Fully operational with animations

### 2. Navigate the Site
Click these menu items:
- **About** - Resort description
- **Amenities** - Facilities (6 items)
- **Rooms** - Room types with pricing (3 options)
- **Gallery** - Images (6 photos)
- **Contact** - Phone number

All sections scroll smoothly and are fully clickable.

---

## 📝 Customize Your Content

### Update Resort Information
Edit `data/mountview.json`:

```json
{
  "name": "Your Resort Name",
  "tagline": "Your tagline here",
  "about": "Your resort description...",
  "branding": {
    "logo": "your-logo-url",
    "heroImage": "your-hero-image-url",
    "name": "Brand Name",
    "primaryColor": "#06b6d4"
  }
}
```

### Update Amenities
```json
"amenities": [
  {
    "name": "Pool",
    "description": "Olympic-sized swimming pool"
  },
  // Add more amenities...
]
```

### Update Rooms
```json
"rooms": [
  {
    "name": "Deluxe Suite",
    "price": "₹10,000 / night",
    "image": "image-url",
    "description": "Spacious suite with..."
  }
]
```

### Update Gallery
```json
"gallery": [
  "image-url-1",
  "image-url-2",
  "image-url-3"
]
```

### Update Contact
```json
"contact": {
  "phone": "+91 1234567890",
  "email": "info@yourresort.com"
}
```

---

## 🎨 Customize Design

### Change Primary Color
In `data/mountview.json`, set your brand color:
```json
"branding": {
  "primaryColor": "#ff6b6b"  // Changes to red
}
```

The system automatically generates lighter/darker shades.

### Disable Features (Optional)
Want to hide a section? In `data/mountview.json`:

```json
"features": {
  "about": true,
  "amenities": false,      // Hide this
  "rooms": true,
  "gallery": false,        // Hide this
  "contact": true
}
```

---

## ✨ What You Get

### First Page (Hero)
- ✅ Animated gradient background
- ✅ Premium logo showcase
- ✅ Glowing title effects
- ✅ "Explore Rooms" button
- ✅ "Get In Touch" button

### Second Page (Content Sections)
- ✅ About section with description
- ✅ Amenities grid (6 items)
- ✅ Rooms showcase (3 types with pricing)
- ✅ Image gallery (responsive grid)
- ✅ Contact section with phone link
- ✅ Premium footer

### Features
- ✅ Smooth scrolling navigation
- ✅ Mobile responsive
- ✅ Automatic animations
- ✅ Glassmorphism effects
- ✅ Premium shadows
- ✅ Color consistency

---

## 🔧 Configuration Options

### Full JSON Structure
```json
{
  "slug": "your-resort",
  "status": "active",
  "name": "Resort Name",
  "tagline": "Your tagline",
  "about": "About text",
  "branding": {
    "logo": "logo-url",
    "heroImage": "hero-image-url",
    "name": "Brand name",
    "primaryColor": "#color-code"
  },
  "amenities": [{...}],
  "rooms": [{...}],
  "gallery": ["image-urls"],
  "contact": {
    "phone": "+91...",
    "email": "email@...",
    "address": "..."
  },
  "location": {
    "address": "...",
    "city": "...",
    "country": "..."
  },
  "features": {
    "about": true,
    "amenities": true,
    "rooms": true,
    "gallery": true,
    "contact": true
  },
  "seo": {
    "title": "...",
    "description": "...",
    "keywords": "...",
    "og": {
      "title": "...",
      "description": "...",
      "image": "...",
      "type": "website"
    }
  },
  "ui": {
    "motion": true
  }
}
```

---

## 🎯 Common Tasks

### Change Hotel Name
```json
"name": "Your New Hotel Name",
"branding": {
  "name": "New Name"
}
```

### Add New Amenity
```json
"amenities": [
  // ... existing items
  {
    "name": "New Amenity",
    "description": "Description here"
  }
]
```

### Add New Room Type
```json
"rooms": [
  // ... existing rooms
  {
    "name": "New Room Type",
    "price": "₹X,XXX / night",
    "image": "room-image-url",
    "description": "Room description"
  }
]
```

### Hide Rooms Section
```json
"features": {
  "rooms": false
}
```
Menu item disappears, section is hidden, buttons are removed.

### Change Button Text
Edit the HTML file `template4.html` and find:
- `<a href="#section-rooms" class="btn-primary" id="heroRoomsBtn">Explore Rooms</a>`
- `<a href="#section-contact" class="btn-secondary" id="heroContactBtn">Get In Touch</a>`

---

## 📱 Preview on Devices

### Desktop
Open `template4.html` in your browser at full width

### Tablet
Resize browser to tablet width (768px) or use Developer Tools

### Mobile
Resize browser to mobile width (375px) or test on actual phone

---

## 🐛 Troubleshooting

### Features Not Showing
- Check JSON syntax is correct
- Ensure `"status": "active"` in data file
- Verify `"features"` object is present
- Check browser console (F12) for errors

### Images Not Loading
- Verify image URLs are correct
- Check URLs are HTTPS (not HTTP)
- Ensure images exist and are accessible
- Use image URLs from reputable sources

### Colors Not Changing
- Check `primaryColor` is a valid hex code (e.g., `#06b6d4`)
- Ensure it's in `branding` object
- Refresh page after saving changes
- Check browser cache (Ctrl+Shift+R)

### Navigation Not Working
- Ensure all features that have menu items are enabled
- Check that `features` object has `true` values for enabled items
- Verify HTML structure hasn't been altered
- Clear browser cache

---

## 📚 Learn More

See detailed documentation in:
- `FEATURE_CONFIG.md` - Complete feature guide
- `IMPLEMENTATION_SUMMARY.md` - Technical details

---

## 🎉 You're Ready!

Your premium resort website is ready to showcase your property. Customize the content, adjust the features, and let it shine!

**Happy hosting! 🏨✨**
