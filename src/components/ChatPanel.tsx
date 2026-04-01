import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { useStore } from '../store/useStore';
import { sendChatMessage, sendAskMessage, cancelGeneration, approvePlan } from '../lib/chat';
import type { Message, ModelId, PipelineStageInfo, ChatAttachment } from '../types';
import { detectIntegrations, detectIntegrationsInFiles, type ServiceKeyDef } from '../lib/integrations';
import StorageSelector from './StorageSelector';

// ─── Attachment helpers ───────────────────────────────────────────────────────

function genAttachId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function processImageFile(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1120;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
          else { w = Math.round((w * MAX) / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64Data = dataUrl.split(',')[1];
        resolve({
          id: genAttachId(),
          type: 'image',
          name: file.name || 'pasted-image.jpg',
          base64Data,
          mediaType: 'image/jpeg',
          dataUrl,
        });
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processTextFile(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve({
        id: genAttachId(),
        type: 'file',
        name: file.name,
        textContent: e.target!.result as string,
      });
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

interface AppIdea {
  title: string;
  prompt: string;
}

const APP_IDEAS: AppIdea[] = [
  { title: 'Build a todo app with drag & drop reordering', prompt: 'Build a todo app with drag & drop reordering. Include add/edit/delete tasks, priority labels (High/Medium/Low), due dates, completion checkmarks, and filters for All/Active/Completed. Support drag & drop reordering with smooth animations and a clean minimal dark UI.' },
  { title: 'Create an analytics dashboard with live charts', prompt: 'Create an analytics dashboard with live charts. Show KPI stat cards (users, revenue, sessions, conversion rate), a line chart for 30-day trends, a bar chart for weekly comparisons, a sortable data table, and date range filters. Use a professional dark theme with vibrant accent colors.' },
  { title: 'Make a SaaS landing page with pricing table', prompt: 'Make a SaaS landing page with a pricing table. Include a bold hero section with headline and CTA buttons, a features grid with icons, a social proof section with testimonials and company logos, a 3-tier pricing table (Free/Pro/Enterprise) with feature checkboxes, and a FAQ accordion.' },
  { title: 'Build a Spotify-like music player UI', prompt: 'Build a Spotify-like music player UI. Include a sidebar with library navigation (playlists, albums, artists), an album/playlist grid view, and a fixed bottom playback bar with track info, progress slider, volume control, and controls (shuffle, prev, play/pause, next, repeat). Use a dark purple/black theme.' },
  { title: 'Design a kanban board like Trello', prompt: 'Design a kanban board like Trello. Include columns (To Do, In Progress, Review, Done) with draggable cards, add/edit/delete cards with title, labels, and assignee avatar, column management, and a board header. Use colorful priority label tags and a clean modern layout.' },
  { title: 'Create a markdown note-taking app', prompt: 'Create a markdown note-taking app with a split-pane view. Include a sidebar notes list with search and folders, a left markdown editor pane, and a right live preview pane rendering formatted output. Add a formatting toolbar (bold, italic, headings, code). Notes list shows title and preview snippet.' },
  { title: 'Build a recipe finder with filters', prompt: 'Build a recipe finder app with ingredient and cuisine filters. Show a recipe card grid with image, title, cook time, difficulty, and rating. Include filter chips for cuisine type (Italian, Asian, Mexican) and diet (Vegetarian, Vegan, Gluten-Free), a search bar, and a recipe detail modal with ingredients list and step-by-step instructions.' },
  { title: 'Make a personal finance tracker with charts', prompt: 'Make a personal finance tracker with charts. Show a monthly summary (income, expenses, savings balance), a donut chart breaking down spending by category, a transaction list with add/edit/delete and category tags, and a 6-month bar chart comparison. Include date filtering and a clean professional design.' },
  { title: 'Design a job board with search and filters', prompt: 'Design a job board with search and filters. Show job posting cards with company name, title, location type (remote/hybrid/onsite), salary range, and posted date. Include a sidebar with filters for job type, experience level, and location. Clicking a job opens a full detail panel with description and an Apply button.' },
  { title: 'Build a real-time chat interface', prompt: 'Build a real-time chat interface. Include a left sidebar with conversation list (avatars, names, unread count badges, last message preview), a main chat area with message bubbles (sent right, received left), timestamps, a typing indicator, emoji picker, and a message input with send button. Use a modern messaging app design.' },
  { title: 'Create a pomodoro timer with stats', prompt: 'Create a pomodoro timer with work/break session tracking. Show a large circular countdown timer switching between 25-min work and 5-min break intervals, session controls (start, pause, reset), a daily stats panel showing completed sessions and total focus time, and a task list to log what you worked on.' },
  { title: 'Build a weather dashboard with forecasts', prompt: 'Build a weather dashboard with forecasts. Show current conditions (temperature, feels-like, humidity, wind speed, UV index) in a hero section, an hourly forecast chart for today, a 7-day forecast grid with condition icons and high/low temps, and a precipitation chart. Use a gradient background that changes with weather conditions.' },
  { title: 'Make a habit tracker with streaks', prompt: 'Make a habit tracker with streak visualization. Show habits with daily check-off circles for each day of the current week, current streak counters, a monthly heat-map calendar showing completion rate, and an overall stats summary. Include add/edit/delete habits with color and icon customization.' },
  { title: 'Design an e-commerce product page', prompt: 'Design a single product page for an e-commerce store. Include a product image gallery with thumbnail strip, title and pricing (with sale badge), size/color variant selectors, quantity input, Add to Cart and Wishlist buttons, a tabbed section for description/specs/reviews with star ratings, and a related products carousel.' },
  { title: 'Build a team wiki knowledge base', prompt: 'Build a team wiki knowledge base. Include a nested sidebar category tree, an article viewer with heading anchors and breadcrumbs, last-edited metadata, a search bar with instant results, and a home page with recently updated articles, popular pages, and category cards.' },
  { title: 'Create a portfolio site with project gallery', prompt: 'Create a personal portfolio site with a project gallery. Include a hero section with animated intro text, an about section with skills grid, a filterable project gallery with tech stack tags and live/GitHub links, a timeline-style work experience section, and a contact form. Use smooth scroll and entrance animations.' },
  { title: 'Build a code snippet manager', prompt: 'Build a code snippet manager. Include a sidebar with language-grouped snippets list and search, a main panel with syntax-highlighted code display and copy-to-clipboard button, and metadata (title, language, tags, created date). Add create/edit/delete snippets, a language selector, tag system, and a favorites feature.' },
  { title: 'Make a travel itinerary planner', prompt: 'Make a travel itinerary planner. Show a destination header with cover image and date range, a day-by-day activity timeline with morning/afternoon/evening slots, and add/edit/delete activities with time, location, category icons (food, hotel, transport, attraction), and notes. Include a packing checklist sidebar and basic budget tracker.' },
  { title: 'Design a social media feed UI', prompt: 'Design a social media feed UI. Include a left navigation sidebar (Home, Explore, Notifications, Profile), a main feed with posts (user avatar, name, timestamp, text, image, like/comment/share/bookmark action buttons), and a right sidebar with trending topics and suggested accounts to follow. Use a clean modern design.' },
  { title: 'Build a workout tracker with progress graphs', prompt: 'Build a workout tracker with progress graphs. Show a workout log with exercise entries (sets, reps, weight), personal record badges, strength progress line charts per exercise over time, a workout calendar heat-map showing consistency, and a weekly summary dashboard with total volume and sessions.' },
  { title: 'Create a flashcard study app', prompt: 'Create a flashcard study app. Include a deck library with deck cards showing title, card count, and last-studied date. A study mode shows one card at a time with a 3D flip animation, self-rating buttons (Again/Hard/Good/Easy), and a progress bar. Add create/edit deck and individual card modes with front/back text fields.' },
  { title: 'Build an invoice generator', prompt: 'Build an invoice generator. Include company and client info fields, a line items table with add/remove rows (description, quantity, unit price, line total), tax rate input, notes field, and auto-calculated subtotal/tax/grand total. Show a styled printable invoice preview and include Print and Download PDF buttons.' },
  { title: 'Make a URL shortener with analytics', prompt: 'Make a URL shortener with click analytics. Include a URL input that generates a short link on submit, a dashboard table of all created links with short code, original URL, creation date, and total click count. Clicking a row expands a daily clicks bar chart for the last 30 days. Include copy and delete actions.' },
  { title: 'Design a restaurant menu ordering app', prompt: 'Design a restaurant menu ordering app. Show a sticky category navigation tabs (Starters, Mains, Desserts, Drinks), menu item cards with image placeholder, name, description, and Add button, and a floating cart badge. The cart opens as a side panel with item list, quantity controls, special instructions field, and order total.' },
  { title: 'Build a poll & survey builder', prompt: 'Build a poll & survey builder. Include a survey builder with multiple question types (multiple choice, text, rating scale, yes/no), drag-to-reorder questions, required field toggle, and a survey title/description field. A preview mode shows the survey as respondents see it. A results view shows bar chart breakdowns per question.' },
  { title: 'Create a calendar app with event management', prompt: 'Create a calendar app with event management. Show a monthly calendar grid view with event pills, a week view with hourly time slots, and a day detail panel. Include add/edit/delete events with title, date/time, color, location, and description. Add a mini-calendar sidebar for quick navigation and an upcoming events list.' },
  { title: 'Build a quiz app with leaderboards', prompt: 'Build a quiz app with leaderboards. Include a home screen with category selection (Science, History, Sports, Pop Culture), a timed question screen with 4 answer choices and animated countdown bar, immediate correct/wrong feedback with explanation, a final score screen with accuracy and time stats, and a top-10 leaderboard table.' },
  { title: 'Make a movie watchlist app', prompt: 'Make a movie watchlist app. Show a grid of movie cards with poster placeholder, title, year, genre tags, and star rating. Include status tabs (Watchlist/Watching/Watched), a 5-star rating system, genre and status filters, a search bar, and a stats sidebar showing total movies, hours watched, and top genres.' },
  { title: 'Design a crypto portfolio tracker', prompt: 'Design a crypto portfolio tracker. Show a portfolio summary header with total value and 24h change, an asset allocation pie chart, and a holdings table with coin icon, name, symbol, amount, current price, total value, and 24h % change (green/red colored). Include an add/remove coin form and sparkline charts per coin.' },
  { title: 'Build a reading list app with progress', prompt: 'Build a reading list app with reading progress tracking. Show book cards with cover placeholder, title, author, genre, status (To Read/Reading/Finished), and a progress bar for books in-progress. Include a reading stats dashboard (books this year, pages read, streak), search, filters, and an add/edit book modal with notes.' },
  { title: 'Create a minimal blog platform', prompt: 'Create a minimal blog platform. Include a home page with article cards (title, date, tags, excerpt, estimated read time), a full article reader with clean serif typography, category/tag filtering, a sidebar with recent posts and popular tags, author bio card, and a dark/light mode toggle.' },
  { title: 'Build a contact management CRM', prompt: 'Build a contact management CRM. Show a contacts list with avatar, name, company, email, phone, and status tags. Include add/edit/delete contacts, a search and multi-filter bar, a contact detail panel with notes, activity timeline, and social links, and a starred/favorites section at the top.' },
  { title: 'Make a budget planner with categories', prompt: 'Make a monthly budget planner with category tracking. Show income vs total expenses summary, a list of budget categories (Housing, Food, Transport, Entertainment) with allocated and spent amounts and progress bars, a bar chart comparing budgeted vs actual by category, and an expense log with add/edit/delete entries.' },
  { title: 'Design a dark-mode text editor', prompt: 'Design a dark-mode code/text editor. Include a file tree sidebar, a tabbed editor pane with syntax highlighting, line numbers, and indentation guides, a bottom status bar (word count, cursor position, language mode), a command palette modal (Ctrl+P), and a find & replace panel. Use a VS Code-inspired layout.' },
  { title: 'Build a news aggregator dashboard', prompt: 'Build a news aggregator dashboard. Show a masonry card feed with article thumbnail, headline, source logo, category tag, and relative timestamp. Include a left sidebar with category and source filters, a search bar, a saved/bookmarked articles section, and infinite scroll pagination. Use a clean editorial design.' },
  { title: 'Create a stock price watchlist', prompt: 'Create a stock price watchlist. Show a table of stocks with ticker symbol, company name, current price, day change in $ and % (green/red), market cap, P/E ratio, and a sparkline mini-chart. Include add/remove stocks, a search with autocomplete, sort by any column, and a portfolio total value summary.' },
  { title: 'Build a password strength checker', prompt: 'Build a password strength checker and generator. Include a password input with show/hide toggle, a real-time strength meter (Weak/Fair/Good/Strong/Excellent) with colored progress bar, a requirements checklist (length ≥12, uppercase, lowercase, numbers, special chars), a breach warning indicator, and a one-click secure password generator.' },
  { title: 'Make a color palette generator', prompt: 'Make a color palette generator. Include a main color picker, harmony mode selector (Complementary, Analogous, Triadic, Tetradic, Monochromatic), generated palette swatches with hex/rgb/hsl values and copy-to-clipboard buttons, a saved palettes gallery, and export options (CSS variables, Tailwind config, JSON).' },
  { title: 'Design a video streaming UI', prompt: 'Design a video streaming UI similar to Netflix. Include a hero banner for featured content, horizontal carousels for categories (Trending Now, New Releases, Top Rated), video cards with hover-to-reveal overlay (title, rating, genre tags), a content detail modal with description, cast, and play button, and a top nav with search.' },
  { title: 'Build a document signing flow', prompt: 'Build a document signing flow UI. Show a document list dashboard, a document viewer with highlighted signature/initials/date fields, a toolbar to add your signature (type, draw, or upload), a progress indicator showing required vs completed fields, and a final confirmation screen with a signed document download button.' },
  { title: 'Create an image gallery with lightbox', prompt: 'Create an image gallery with lightbox. Show a responsive masonry or grid layout of images with hover overlay (title, tags, category). Clicking opens a full-screen lightbox with the image, prev/next navigation arrows, zoom control, and keyboard shortcuts (arrows, Esc). Include category filter chips and a search bar.' },
  { title: 'Build a feedback & voting board', prompt: 'Build a product feedback and voting board like Canny. Show posts with upvote button and count, title, comment count, status badge (Under Review/Planned/In Progress/Done), and author avatar. Include a submit feedback form, filter by status and category, sort by votes or newest, and admin status-update controls.' },
  { title: 'Make a multi-step onboarding wizard', prompt: 'Make a multi-step onboarding wizard. Include a progress stepper showing all steps, animated slide transitions between steps, per-step form validation, back/next navigation, a review/summary step before final submit, and a completion screen with confetti animation and next steps checklist. Show clear step count (Step 2 of 5).' },
  { title: 'Design a ride-sharing app UI', prompt: 'Design a ride-sharing app UI. Show a full-screen map placeholder, a bottom sheet with pickup/destination inputs, a vehicle type selector (Economy, Comfort, XL) with icons and prices, an estimated arrival time, a booking confirmation screen with driver info and ETA countdown, and a ride-in-progress tracker.' },
  { title: 'Build a typing speed test app', prompt: 'Build a typing speed test app. Show a passage of text with characters highlighted as typed (green for correct, red for incorrect), a live WPM counter and accuracy percentage, a countdown timer, an instant restart button, and a results screen with WPM, accuracy, error count, and a comparison to previous best attempts.' },
  { title: 'Create a chess game board', prompt: 'Create a chess game board UI. Render an 8x8 board with alternating light/dark squares, Unicode chess piece characters in standard starting positions, click-to-select highlighting with valid move squares highlighted, a turn indicator, captured pieces display on each side, and a basic move history log.' },
  { title: 'Build a GitHub stats visualizer', prompt: 'Build a GitHub profile stats visualizer. Show a user profile header with avatar, bio, follower/following counts, a contribution heatmap calendar, repository cards with stars/forks/language badge, a top languages donut chart, commit activity over time, and a most-starred repositories ranked list.' },
  { title: 'Make a timezone converter tool', prompt: 'Make a world timezone converter tool. Show a list of 8 world clocks (New York, London, Paris, Dubai, Mumbai, Tokyo, Sydney, Los Angeles) with current times, city names, and UTC offsets. Include a main time input that updates all clocks simultaneously, add/remove timezones, and a meeting planner showing overlapping 9-5 business hours across selected zones.' },
  { title: 'Design a medication reminder app', prompt: 'Design a medication reminder app. Show a daily schedule with medication cards (name, dosage, time, taken/missed status with color indicators), a weekly adherence calendar heat-map, add/edit/delete medications with dose frequency settings, and a monthly stats view showing overall adherence rate and a missed doses log.' },
  { title: 'Build a classroom quiz platform', prompt: 'Build a classroom quiz platform. Include a teacher dashboard with create-quiz form (question editor with 4 options and correct answer), a quiz list with shareable join codes, and a live results view with student scores. The student view shows a clean quiz interface with a question counter, timer, and submission confirmation.' },
  { title: 'Create a flight search results page', prompt: 'Create a flight search results page. Show a filter sidebar (number of stops, price range, airlines, departure time window), a results list of flight cards (airline logo, departure/arrival times, duration, stops, cabin class, and price), a sort bar (cheapest/fastest/best), and an expandable flight detail with fare breakdown and baggage info.' },
  { title: 'Build a sports scoreboard dashboard', prompt: 'Build a live sports scoreboard dashboard. Show game score cards with team names, logos, current score, game period/quarter, and time remaining. Include a scores-by-period breakdown table, key player stats, a recent highlights text feed, and a league standings table. Use red/green accents and bold score typography.' },
  { title: 'Make a mind-map creator', prompt: 'Make a mind-map creator. Show a central root node with radiating child nodes on a canvas, click-to-add child nodes, drag to reposition nodes, double-click to edit node text, delete node button, color-coded levels, connect nodes with curved lines, zoom in/out controls, and an export as PNG button.' },
  { title: 'Design a social network profile page', prompt: 'Design a social network profile page. Include a cover photo, circular profile avatar, display name, bio, follow/message/share buttons, follower and following counts, a post grid/list view toggle, a pinned highlights strip, and tabbed sections for Posts, Media, Likes, and About with edit profile capability.' },
  { title: 'Build a savings goal tracker', prompt: 'Build a savings goal tracker. Show goal cards with title, target amount, saved amount, progress bar, deadline countdown, and status (On Track/Behind/Achieved). Include add/edit/delete goals, a deposit form to log contributions with date and notes, a contributions history timeline, and a total savings summary banner.' },
  { title: 'Create a project roadmap timeline', prompt: 'Create a project roadmap timeline. Show quarters as columns (Q1/Q2/Q3/Q4) with feature/epic cards organized in theme rows. Include drag cards between quarters, add/edit/delete roadmap items with title, description, team tag, and status chip (Planned/In Progress/Shipped), a legend, and header with roadmap title and export button.' },
  { title: 'Build a daily journal app', prompt: 'Build a daily journal app. Show a calendar to navigate between entries, a rich text editor for the current day with word count, a mood selector with emoji scale (1-5), weather input, and photo placeholder. Include a search across all entries, writing streak tracker, and a past entries list with mood icons and snippet previews.' },
  { title: 'Make a restaurant review finder', prompt: 'Make a restaurant review finder. Show restaurant cards with cuisine type, price range ($-$$$$), star rating with review count, distance, and open/closed status. Include filters for cuisine, price range, and rating threshold, a search bar, a map view placeholder, and a restaurant detail page with sample menu and reviews.' },
  { title: 'Design an IoT sensor dashboard', prompt: 'Design an IoT sensor monitoring dashboard. Show device cards with sensor name, location, real-time value with unit, status indicator (Online/Warning/Offline), and mini sparkline chart. Include a large historical data chart for the selected sensor, alert threshold sliders, a device grid floor-map layout, and a status summary header.' },
  { title: 'Build a browser extension popup UI', prompt: 'Build a browser extension popup UI (400px wide). Include a header with extension name and settings icon, a main action area with primary controls, feature toggle switches, a recent activity list with timestamps, quick stats, and a help/feedback link. Make it feel like a polished, production-ready browser extension.' },
  { title: 'Create a code review checklist tool', prompt: 'Create a code review checklist tool. Include predefined checklist categories (Security, Performance, Tests, Documentation, Code Style) with expandable items, ability to add custom checklist items, check-off items per review session, save reusable templates, add inline comments on flagged items, and export a formatted review summary report.' },
  { title: 'Build a wedding planner dashboard', prompt: 'Build a wedding planner dashboard. Show a countdown to the wedding date, a budget tracker with category breakdown (venue, catering, flowers, photos) vs spent, a guest list manager with RSVP tracking and meal choices, a vendor checklist with booked/pending/needed status, and a month-by-month task timeline.' },
  { title: 'Make a subscription cost tracker', prompt: 'Make a monthly subscription cost tracker. Show subscription cards with service name, logo placeholder, billing cycle, monthly cost, renewal date, category, and active/paused status. Include total monthly and annual cost summaries, a spending-by-category donut chart, an upcoming renewals list sorted by due date, and add/edit/delete subscriptions.' },
  { title: 'Design a music album browser', prompt: 'Design a music album browser. Show an album grid with artwork placeholder, title, artist name, year, and genre tags. Clicking opens an album detail view with tracklist and durations, artist bio sidebar, and similar albums. Include search, genre filter chips, a top-rated albums ranked list, and a recently added section.' },
  { title: 'Build a plant care reminder app', prompt: 'Build a plant care reminder app. Show plant cards with photo placeholder, name, species, last-watered date, and next care due in X days (red if overdue). Track watering, fertilizing, and repotting schedules. Include mark-as-done buttons, a care history log, overdue alerts banner, and add/edit/delete plant forms with care frequency settings.' },
  { title: 'Create a meeting scheduler UI', prompt: 'Create a meeting scheduler UI. Show a week view with participant availability grid (green = free, red = busy, yellow = tentative), click to propose a time slot, a participants list with availability status indicators, a meeting details form (title, duration, location, agenda), and a booking confirmation summary with calendar invite preview.' },
  { title: 'Build a data table with sorting & filters', prompt: 'Build a feature-rich data table UI. Include column header click-to-sort with direction arrows, a global search input, per-column filter dropdowns, row selection checkboxes with bulk action toolbar (delete, export, tag), pagination with configurable page size, row detail expansion, column visibility toggle, and CSV export.' },
  { title: 'Make a drawing canvas app', prompt: 'Make a drawing canvas app. Include a toolbar with pencil, eraser, shapes (rectangle, circle, line, arrow), fill/stroke color pickers, stroke width slider, opacity control, undo/redo (Ctrl+Z/Y), clear canvas, and save as PNG. Support mouse drawing with smooth strokes. Display canvas dimensions and current tool in a status bar.' },
  { title: 'Design a hotel booking page', prompt: 'Design a hotel room booking page. Include a search form (destination, check-in/check-out dates, guests), a results list of hotel cards (cover image, name, star rating, amenities icons, price/night, and Book button), a price range and amenities filter sidebar, a room detail modal with photo gallery and room type options.' },
  { title: 'Build a word frequency visualizer', prompt: 'Build a word frequency visualizer. Include a text input/paste area, a tag-cloud visualization where word size scales with frequency, a sortable top-50 frequency table (word, count, % of total), a stop-words toggle to filter common words, and a download chart as PNG button. Animate updates in real-time as user types.' },
  { title: 'Create a countdown timer for launches', prompt: 'Create a countdown timer for product launches and events. Show a large animated flipping-digit countdown (days, hours, minutes, seconds) for the next event, a list of multiple saved countdowns sorted by nearest first, add/edit/delete countdowns with title, target datetime, and color theme, and a confetti burst animation on completion.' },
  { title: 'Build a theme/color scheme switcher demo', prompt: 'Build a UI theme and color scheme switcher demo. Include 6 preset themes (Ocean, Forest, Sunset, Neon, Monochrome, Rose), a live preview of UI components (buttons, cards, inputs, badges, alerts, charts) that instantly updates on theme switch, a dark/light mode toggle, and a custom color picker to define a new theme accent color.' },
  { title: 'Make a grocery list organizer', prompt: 'Make a grocery list organizer. Show items grouped by store section (Produce, Dairy, Meat, Bakery, Frozen, Pantry) with check-off on purchase. Include add items with quantity and section assignment, a search to quickly add from a suggested common items list, an aisle-order shopping mode, and a recent/frequent items quick-add panel.' },
  { title: 'Design a podcast player UI', prompt: 'Design a podcast player UI. Include a shows library with podcast artwork and subscribe toggle, an episode feed list for selected shows, episode cards with play button, duration, and description. A persistent bottom player bar shows the current episode, progress slider, playback speed selector, skip-15s forward/back buttons, and a queue.' },
  { title: 'Build a commit history timeline', prompt: 'Build a git commit history timeline viewer. Show commits in a vertical timeline with branch graph visualization, commit short hash, author avatar and name, commit message, relative timestamp, and changed-files count. Clicking expands a diff summary. Include branch selector dropdown, author filter, and date range picker.' },
  { title: 'Create a knowledge quiz trivia game', prompt: 'Create a knowledge quiz trivia game. Include a home screen with category selection (Science, History, Geography, Sports, Movies) and difficulty level. A question screen shows the question, 4 multiple-choice answers, an animated timer bar, and immediate correct/wrong feedback with a brief explanation. End with a score screen and replay button.' },
  { title: 'Build a user onboarding checklist', prompt: 'Build a user onboarding checklist UI. Show a vertical checklist of setup steps (Complete your profile, Connect your first integration, Invite a teammate, Complete your first task, Explore the dashboard) each with an icon, title, short description, and complete/skip buttons. Include an overall progress bar and a confetti animation when all steps are done.' },
  { title: 'Make a student grade tracker', prompt: 'Make a student grade tracker. Show a courses list with current grade percentage and letter grade per course. Inside each course, track assignments with name, points earned/total, and weight. Include a GPA calculator across all courses, a grade-over-time line chart per course, and a semester summary with highest and lowest performing courses.' },
  { title: 'Design a delivery tracking page', prompt: 'Design an order delivery tracking page. Show an order header with tracking number, carrier, and estimated delivery date. Include a vertical step timeline (Order Placed → Processing → Shipped → In Transit → Out for Delivery → Delivered) with timestamps and location updates. Show a map placeholder, order items list, and contact support button.' },
  { title: 'Build a multi-currency converter', prompt: 'Build a multi-currency converter. Show a from-currency input with currency selector that live-converts to 10+ currencies in a results grid showing exchange rate and converted amount. Include a rates comparison table, a 30-day historical rate chart for the selected currency pair, and a favorite currencies pin feature.' },
  { title: 'Create a writing prompt generator', prompt: 'Create a writing prompt generator. Include genre selector chips (Fantasy, Sci-Fi, Romance, Mystery, Horror, Historical, Thriller), a generate button that produces a detailed prompt with character description, setting, and central conflict. Add save favorites, tag and search prompts, copy to clipboard, and a history of recently generated prompts.' },
  { title: 'Build a system health monitoring UI', prompt: 'Build a system health monitoring dashboard. Show real-time metric cards for CPU, memory, disk, and network (value, trend arrow, color-coded status green/yellow/red), line charts for each metric over the last 60 minutes, a top-processes table sorted by CPU/memory usage, configurable alert thresholds, and an incident log.' },
  { title: 'Make a book club reading tracker', prompt: 'Make a book club reading tracker. Show the current book with cover, reading progress bar, and next meeting date. Include a members list with individual progress percentages, a voting section for the next book with candidate cards and upvote counts, a discussion questions panel, and a reading history with past books and group ratings.' },
  { title: 'Design a payment checkout flow', prompt: 'Design a 3-step payment checkout flow. Step 1: Cart review with item list, quantities, item subtotals, promo code input, and order total. Step 2: Shipping form with address autocomplete. Step 3: Payment form with formatted card number, expiry, CVV, and billing address. Show a persistent order summary sidebar and a step progress indicator throughout.' },
  { title: 'Build a web scraping results viewer', prompt: 'Build a web scraping results viewer. Include a URL input with a scrape/fetch button, a structured results panel showing scraped data in a data table with editable column names and type selectors, row count summary, export as CSV or JSON buttons, a scrape history sidebar, and a field selector panel to choose which page elements to extract.' },
  { title: 'Create an animated hero section builder', prompt: 'Create a drag-and-drop animated hero section builder. Show a live canvas preview of a hero with editable headline (with gradient options), subheadline, and CTA button. Include a right panel with controls for font family, font size, colors, button style, background (solid/gradient/image), and animation type (fade, slide-up, typewriter). Export as HTML code.' },
  { title: 'Build a voting & decision tool', prompt: 'Build a group voting and decision tool. Show a decision title, add/remove option cards with title and description, a voting interface with upvote buttons and result bars updating in real-time, a winner announcement with confetti, round history, and a share-link generator so others can join the vote. Include both single-vote and ranked-choice modes.' },
  { title: 'Make a logo design showcase', prompt: 'Make a logo design portfolio showcase. Show a filterable grid of logo cards with brand name, industry tag, and dominant color palette swatches. Clicking opens a detail modal displaying the logo on light/dark/colored backgrounds, brand color codes, typography used, and a brief project description. Include search and filter by industry.' },
  { title: 'Design a user feedback widget', prompt: 'Design a user feedback collection widget. Show a floating feedback button (bottom-right corner) that opens a compact popup form with a mood rating (5-emoji scale), a text field for details, and an optional email field. Include a thank-you confirmation state. Build an admin panel view showing all feedback in a sortable table with mood distribution chart.' },
  { title: 'Build a personal OKR tracker', prompt: 'Build a personal OKR (Objectives and Key Results) tracker. Show Objectives as expandable cards with description, quarter, and an aggregate progress bar from Key Results. Each Key Result has a title, metric type (%, number, or binary), start/current/target values, and inline editable current value. Include add/edit/delete objectives and KRs, and an overall score.' },
  { title: 'Create a chat bot interface', prompt: 'Create a chatbot interface. Include a chat window with user message bubbles (right, blue) and bot message bubbles (left, gray) with avatar, a typing indicator with animated dots, quick-reply suggestion chips below bot responses, timestamps, a message input with send button, and a left sidebar with conversation history list.' },
  { title: 'Build a retro arcade scoreboard', prompt: 'Build a retro arcade-style scoreboard. Use a pixelated/8-bit aesthetic with neon green/yellow text on a black background, a scanline overlay effect, and a CRT-style decorative border. Show a top-10 high scores list with rank, 3-letter initials, and score. Include an animated score entry form with a blinking cursor and score-counting animation.' },
  { title: 'Make a dark/light theme showcase', prompt: 'Make a UI component showcase with dark/light theme switching. Build a demo page displaying all common components: buttons (all variants and states), form inputs (text, select, checkbox, radio, toggle), cards, badges, alerts, modal dialogs, data tables, and navigation. All components instantly toggle between dark and light mode with a single switch.' },
  { title: 'Design a fundraising progress page', prompt: 'Design a fundraising campaign progress page. Show a hero section with campaign title, cause description, and cover image. Include a prominent circular progress visualization showing amount raised vs goal, donor count, days remaining, a recent donors feed with amounts and optional messages, a share buttons strip, and a large Donate Now CTA button.' },
  { title: 'Build a restaurant table reservation UI', prompt: 'Build a restaurant table reservation UI. Show a restaurant info header with name, cuisine, and rating. Include a date/time/party-size selector, an interactive floor-plan layout showing tables (colored by available/reserved/occupied), a table selection confirmation with seat details, a reservation form with contact details, and a booking confirmation summary.' },
  { title: 'Create a product roadmap board', prompt: 'Create a Now/Next/Later product roadmap board. Show three columns with feature cards, each card showing title, team tag, status chip (Planned/In Progress/Shipped), and priority dot. Include drag between columns, add/edit/delete cards with rich description, filter by team and status, a header with roadmap title, and a card detail slide-out panel.' },
  { title: 'Build a beer/wine tasting notes app', prompt: 'Build a beverage tasting notes app. Show a collection grid of tasting cards with name, producer, type/style, vintage year, date tasted, and star rating. Clicking expands a full tasting note with color, aroma, palate, and finish fields, food pairing suggestions, and a personal score out of 100. Include add new note form and search/filter by type and rating.' },
  { title: 'Make a coding challenge leaderboard', prompt: 'Make a coding challenge leaderboard. Show a ranked table with rank change arrows (↑↓), avatar, username, total score, problems solved, acceptance rate, and current streak. Include a problems list with difficulty tags (Easy/Medium/Hard), solved/unsolved status icons, and a user profile modal with submission history chart and top languages bar chart.' },
  { title: 'Design an event ticketing page', prompt: 'Design an event ticketing page. Show an event hero with event name, date/time, venue, and description. Include a ticket type selector with quantities and prices (GA, VIP, Early Bird) with availability indicators, an order summary sidebar with fees and total, a checkout form with contact info and payment fields, and a booking confirmation screen with a QR code placeholder.' },
  { title: 'Build a language learning flashcard deck', prompt: 'Build a language learning flashcard deck. Include a language pair selector (English → Spanish/French/Japanese...), a deck browser with category cards (Greetings, Food, Travel, Business), a study mode with the foreign word on front and translation + pronunciation on flip, difficulty self-rating buttons (Again/Hard/Good/Easy), a session progress bar, and a mastery stats screen.' },
  { title: 'Create a night-sky star chart viewer', prompt: 'Create a night-sky star chart viewer. Show an interactive circular sky map with stars plotted as dots sized by magnitude (larger = brighter), constellation line patterns, planet position markers, and hover tooltips with star name, magnitude, and constellation. Include a location/date control panel and a sidebar listing currently visible planets and notable deep-sky objects.' },
];

const IMPROVEMENT_IDEAS: AppIdea[] = [
  { title: 'Add dark mode / light mode toggle', prompt: 'Add dark mode / light mode toggle' },
  { title: 'Make the layout fully responsive for mobile', prompt: 'Make the layout fully responsive for mobile' },
  { title: 'Add smooth animations and transitions', prompt: 'Add smooth animations and transitions' },
  { title: 'Add loading states and skeleton screens', prompt: 'Add loading states and skeleton screens' },
  { title: 'Add error handling and empty states', prompt: 'Add error handling and empty states' },
  { title: 'Improve the color scheme and typography', prompt: 'Improve the color scheme and typography' },
  { title: 'Add a search or filter feature', prompt: 'Add a search or filter feature' },
  { title: 'Add keyboard shortcuts', prompt: 'Add keyboard shortcuts' },
  { title: 'Add drag-and-drop support', prompt: 'Add drag-and-drop support' },
  { title: 'Add toast notifications', prompt: 'Add toast notifications' },
  { title: 'Add data export (CSV or JSON)', prompt: 'Add data export (CSV or JSON)' },
  { title: 'Add a settings / preferences panel', prompt: 'Add a settings / preferences panel' },
  { title: 'Add undo / redo functionality', prompt: 'Add undo / redo functionality' },
  { title: 'Add pagination or infinite scroll', prompt: 'Add pagination or infinite scroll' },
  { title: 'Add charts or data visualizations', prompt: 'Add charts or data visualizations' },
  { title: 'Improve accessibility with ARIA labels', prompt: 'Improve accessibility with ARIA labels' },
  { title: 'Add a confirmation dialog for destructive actions', prompt: 'Add a confirmation dialog for destructive actions' },
  { title: 'Add a sidebar navigation', prompt: 'Add a sidebar navigation' },
  { title: 'Add breadcrumbs for navigation', prompt: 'Add breadcrumbs for navigation' },
  { title: 'Add a print-friendly view', prompt: 'Add a print-friendly view' },
  { title: 'Add multi-language / i18n support', prompt: 'Add multi-language / i18n support' },
  { title: 'Add a onboarding walkthrough', prompt: 'Add a onboarding walkthrough' },
  { title: 'Refactor with a cleaner component structure', prompt: 'Refactor with a cleaner component structure' },
  { title: 'Add input validation and inline error messages', prompt: 'Add input validation and inline error messages' },
  { title: 'Add a collapsible/expandable section', prompt: 'Add a collapsible/expandable section' },
  { title: 'Add a progress indicator or stepper', prompt: 'Add a progress indicator or stepper' },
  { title: 'Add a date/time picker', prompt: 'Add a date/time picker' },
  { title: 'Add shareable links or deep linking', prompt: 'Add shareable links or deep linking' },
];

function pickBatch(pool: AppIdea[] = APP_IDEAS): AppIdea[] {
  const available = [...pool];
  const batch: AppIdea[] = [];
  for (let i = 0; i < 8 && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length);
    batch.push(available.splice(idx, 1)[0]);
  }
  return batch;
}

interface Suggestion {
  label: string;
  prompt: string;
}

interface PendingKeyRequest {
  service: string;
  description: string;
  keys: ServiceKeyDef[];
  /** Values being typed — keyed by envName */
  values: Record<string, string>;
  /** The original message waiting to be sent */
  pendingMessage: string;
  pendingAttachments: ChatAttachment[];
}

export default function ChatPanel() {
  const {
    messages, isGenerating, hasApiKey,
    selectedModel, setSelectedModel, isAutoMode, setIsAutoMode,
    files, projectSecrets, setProjectSecret,
    promptQueue, queuePaused, addToQueue, removeFromQueue, updateQueueItem, setQueuePaused, clearQueue,
    clearVisibleMessages,
  } = useStore();
  const [chatMode, setChatMode] = useState<'build' | 'ask'>('build');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [ideaBatch, setIdeaBatch] = useState<AppIdea[]>(() =>
    pickBatch(Object.keys(useStore.getState().files).length > 0 ? IMPROVEMENT_IDEAS : APP_IDEAS)
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueValue, setEditingQueueValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [pendingKeyRequest, setPendingKeyRequest] = useState<PendingKeyRequest | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);
  const [ideaSearch, setIdeaSearch] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userScrolledUp = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const hasSpeechRecognition = typeof window !== 'undefined' && (
    !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition
  );
  const hasFiles = Object.keys(files).length > 0;

  function toggleDictation() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (e: any) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) {
        setInput((prev) => (prev ? prev + ' ' + final : final));
        textareaRef.current?.focus();
      }
    };
    recognition.start();
  }

  async function rewritePrompt() {
    const trimmed = input.trim();
    if (!trimmed || isRewriting) return;
    setIsRewriting(true);
    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed, files }),
      });
      const data = await res.json();
      if (data.rewritten && data.rewritten !== trimmed) {
        setInput(data.rewritten);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    } catch {
      // silently fail — leave input unchanged
    } finally {
      setIsRewriting(false);
    }
  }

  // Re-roll idea batch whenever project state changes (new vs. existing project)
  const prevMessageCount = useRef(messages.length);
  const prevHasFiles = useRef<boolean | null>(null); // null = not yet initialized
  useEffect(() => {
    const justCleared = messages.length === 0 && prevMessageCount.current > 0;
    const projectTypeChanged = prevHasFiles.current !== null && hasFiles !== prevHasFiles.current;
    if (justCleared || projectTypeChanged) {
      setIdeaBatch(pickBatch(hasFiles ? IMPROVEMENT_IDEAS : APP_IDEAS));
    }
    prevHasFiles.current = hasFiles;
  }, [messages.length, hasFiles]);

  // When a new message is sent (not streaming content), always scroll to bottom
  useEffect(() => {
    const newCount = messages.length;
    if (newCount > prevMessageCount.current) {
      // New message added — reset and scroll to bottom
      userScrolledUp.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (!userScrolledUp.current) {
      // Streaming update — only scroll if user hasn't scrolled up
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCount.current = newCount;
  }, [messages]);

  // Fetch AI suggestions whenever the project files change
  useEffect(() => {
    const fileKeys = Object.keys(files);
    if (fileKeys.length === 0) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    const controller = new AbortController();
    setLoadingSuggestions(true);
    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setSuggestions(data.suggestions || []))
      .catch((e) => { if (e.name !== 'AbortError') setSuggestions([]); })
      .finally(() => setLoadingSuggestions(false));
    return () => controller.abort();
  }, [files]);

  // Re-fetch suggestions when generation finishes (covers cases where files didn't change)
  const prevIsGenerating = useRef(false);
  useEffect(() => {
    const justFinished = prevIsGenerating.current && !isGenerating;
    prevIsGenerating.current = isGenerating;
    if (!justFinished || Object.keys(files).length === 0) return;
    const controller = new AbortController();
    setLoadingSuggestions(true);
    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setSuggestions(data.suggestions || []))
      .catch((e) => { if (e.name !== 'AbortError') setSuggestions([]); })
      .finally(() => setLoadingSuggestions(false));

    // After generation, scan generated files for integrations that need API keys
    if (!pendingKeyRequest) {
      const currentSecrets = useStore.getState().projectSecrets;
      const detected = detectIntegrationsInFiles(files, currentSecrets);
      if (detected.length > 0) {
        const first = detected[0];
        setPendingKeyRequest({
          service: first.def.service,
          description: first.def.description,
          keys: first.missingKeys,
          values: Object.fromEntries(first.missingKeys.map((k) => [k.envName, ''])),
          pendingMessage: '',
          pendingAttachments: [],
        });
      }
    }

    return () => controller.abort();
  }, [isGenerating]);

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Consider "near bottom" if within 80px of the bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUp.current = !nearBottom;
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // Auto-execute next queued item when generation finishes
  useEffect(() => {
    if (isGenerating || queuePaused) return;
    const { promptQueue: q } = useStore.getState();
    if (q.length === 0) return;
    const timer = setTimeout(() => {
      // Re-check state inside timeout (may have changed)
      const { promptQueue: current, queuePaused: paused, isGenerating: gen, removeFromQueue: remove } = useStore.getState();
      if (gen || paused || current.length === 0) return;
      const next = current[0];
      remove(next.id);
      sendChatMessage(next.prompt);
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, queuePaused]);

  async function doSend(message: string, atts: ChatAttachment[], mode: 'build' | 'ask' = 'build') {
    if (mode === 'ask') {
      if (!isGenerating) {
        await sendAskMessage(message, atts);
      }
      return;
    }
    if (isGenerating) {
      if (message) addToQueue(message);
    } else {
      await sendChatMessage(message, { attachments: atts });
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    // Check if message requires API keys for third-party integrations
    const needed = detectIntegrations(trimmed, projectSecrets);
    if (needed.length > 0 && !isGenerating) {
      const first = needed[0];
      setInput('');
      setAttachments([]);
      setPendingKeyRequest({
        service: first.def.service,
        description: first.def.description,
        keys: first.missingKeys,
        values: Object.fromEntries(first.missingKeys.map((k) => [k.envName, ''])),
        pendingMessage: trimmed,
        pendingAttachments: [...attachments],
      });
      return;
    }

    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    await doSend(trimmed, currentAttachments, chatMode);
  }

  async function handleKeySubmit() {
    if (!pendingKeyRequest) return;
    // Store all provided keys
    for (const [envName, value] of Object.entries(pendingKeyRequest.values)) {
      if (value.trim()) setProjectSecret(envName, value.trim());
    }
    const { pendingMessage, pendingAttachments } = pendingKeyRequest;
    setPendingKeyRequest(null);
    // Only send a message if there's an actual pending prompt (not a post-generation key request)
    if (pendingMessage) {
      await doSend(pendingMessage, pendingAttachments, 'build');
    }
  }

  function handleKeyRequestSkip() {
    if (!pendingKeyRequest) return;
    const { pendingMessage, pendingAttachments } = pendingKeyRequest;
    setPendingKeyRequest(null);
    doSend(pendingMessage, pendingAttachments, 'build');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return; // let normal text paste through
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const att = await processImageFile(file);
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        console.error('Failed to process pasted image:', err);
      }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // reset so same file can be re-uploaded
    for (const file of files) {
      try {
        let att: ChatAttachment;
        if (file.type.startsWith('image/')) {
          att = await processImageFile(file);
        } else {
          att = await processTextFile(file);
        }
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        console.error('Failed to process file:', err);
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  // Visible messages are those not hidden (hidden = archived as AI memory after a clear)
  const visibleMessages = messages.filter((m) => !m.hidden);
  const showSuggestions = visibleMessages.length <= 1 && !isGenerating;
  // Once an app has been built, change the welcome message to reflect that
  const displayMessages = visibleMessages.map((m) =>
    m.id === 'welcome' && hasFiles
      ? {
          ...m,
          content: `👋 Your app is ready! Ask me to make changes, add features, fix bugs, or anything else.`,
        }
      : m
  );
  // Hidden messages count — shown as an indicator when context memory is active
  const hiddenCount = messages.filter((m) => m.hidden).length;

  // The latest user message — shown as a sticky "working on" banner while generating
  const activePrompt = isGenerating
    ? [...messages].reverse().find((m) => m.role === 'user')?.content ?? null
    : null;

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Active-prompt banner — always at the very top while generating */}
      {activePrompt && (
        <div className="flex-shrink-0 px-3 pt-2 pb-2.5 bg-indigo-950/60 border-b border-indigo-500/30">
          <div className="flex items-start gap-2.5">
            <svg
              className="w-3.5 h-3.5 text-indigo-400 animate-spin flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-90"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-indigo-400/80 uppercase tracking-widest font-semibold mb-0.5">
                Working on
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed line-clamp-2 break-words">
                {activePrompt}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 scrollbar-thin"
      >
        {displayMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRePrompt={(content) => { setInput(content); textareaRef.current?.focus(); }}
            onFix={(errorText) => {
              sendChatMessage(`SURGICAL FIX\nError: ${errorText}\n\nFix this error in the current files.`);
            }}
            onImplement={(text) => { setChatMode('build'); setInput(text); textareaRef.current?.focus(); }}
            onBuildFromAsk={(prompt) => {
              setChatMode('build');
              doSend(prompt, [], 'build');
            }}
          />
        ))}

        {showSuggestions && (
          <div className="pt-4 space-y-2 animate-fade-in">
            <style>{`
              @keyframes pill-in {
                from { opacity: 0; transform: translateY(8px); }
                to   { opacity: 1; transform: translateY(0); }
              }
              .pill-animate {
                opacity: 0;
                animation: pill-in 0.22s ease-out forwards;
              }
            `}</style>
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium">
                {hasFiles ? 'Suggestions' : 'Ideas'}
              </span>
              {!hasFiles && !ideaSearch && (
                <button
                  onClick={() => {
                    setIsShuffling(true);
                    setTimeout(() => {
                      setIdeaBatch(pickBatch(APP_IDEAS));
                      setIsShuffling(false);
                    }, 400);
                  }}
                  disabled={isShuffling}
                  title="Shuffle ideas"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-60"
                >
                  {isShuffling ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  Shuffle
                </button>
              )}
              {hasFiles && (
                <button
                  onClick={() => {
                    setIsShuffling(true);
                    setTimeout(() => {
                      setIdeaBatch(pickBatch(IMPROVEMENT_IDEAS));
                      setIsShuffling(false);
                    }, 400);
                  }}
                  disabled={isShuffling}
                  title="Shuffle suggestions"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-60"
                >
                  {isShuffling ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  Shuffle
                </button>
              )}
            </div>
            {!hasFiles && (
              <div className="relative px-0.5 pb-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
                <input
                  type="text"
                  value={ideaSearch}
                  onChange={(e) => setIdeaSearch(e.target.value)}
                  placeholder="Search ideas..."
                  className="w-full pl-8 pr-8 py-1.5 text-xs text-zinc-400 placeholder-zinc-600 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600 focus:text-zinc-300 transition-colors"
                />
                {ideaSearch && (
                  <button
                    onClick={() => setIdeaSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {(() => {
              const pool = hasFiles ? ideaBatch : (
                ideaSearch
                  ? APP_IDEAS.filter(idea => idea.title.toLowerCase().includes(ideaSearch.toLowerCase()))
                  : ideaBatch
              );
              if (!hasFiles && ideaSearch && pool.length === 0) {
                return (
                  <p className="text-xs text-zinc-600 text-center py-3">No ideas match "{ideaSearch}"</p>
                );
              }
              return pool.map((idea, i) => (
                <button
                  key={idea.title}
                  onClick={() => { setInput(idea.prompt); textareaRef.current?.focus(); }}
                  className="pill-animate w-full text-left px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-all duration-150"
                  style={{ animationDelay: ideaSearch ? '0ms' : `${i * 40}ms` }}
                >
                  {idea.title}
                </button>
              ));
            })()}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!hasApiKey && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-400 text-xs">
          <strong className="block mb-1">API Key Missing</strong>
          Create a <code className="bg-red-950/60 px-1 rounded">.env</code> file with:
          <pre className="mt-1 text-red-300">ANTHROPIC_API_KEY=sk-ant-...</pre>
        </div>
      )}

      {/* AI suggestions pills — always visible when project has files */}
      {(suggestions.length > 0 || loadingSuggestions) && (
        <div className="px-4 pt-3 pb-0 border-t border-zinc-800">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            {loadingSuggestions
              ? [1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 h-7 w-24 rounded-full bg-zinc-800 animate-pulse"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                ))
              : suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(s.prompt);
                      textareaRef.current?.focus();
                    }}
                    title={s.prompt}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full border border-zinc-700/60 text-zinc-400 hover:text-zinc-100 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-xs font-medium transition-all duration-150 whitespace-nowrap"
                  >
                    <svg className="w-3 h-3 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {s.label}
                  </button>
                ))}
          </div>
        </div>
      )}

      {/* Prompt queue panel */}
      {promptQueue.length > 0 && (
        <div className="px-4 pt-3 pb-0 border-t border-zinc-800">
          <div className="rounded-xl border border-zinc-700/50 overflow-hidden bg-zinc-900/40">
            {/* Queue header */}
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/40 border-b border-zinc-700/30">
              <div className="flex items-center gap-2">
                <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10" />
                </svg>
                <span className="text-xs font-medium text-zinc-400">
                  Queue <span className="text-zinc-600">({promptQueue.length})</span>
                </span>
                {queuePaused && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                    Paused
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQueuePaused(!queuePaused)}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium transition-colors ${
                    queuePaused
                      ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                      : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  {queuePaused ? 'Resume' : 'Pause'}
                </button>
                <div className="w-px h-3 bg-zinc-700 mx-0.5" />
                {confirmClearAll ? (
                  <span className="flex items-center gap-1">
                    <span className="text-[11px] text-zinc-400">Clear all?</span>
                    <button
                      onClick={() => { clearQueue(); setConfirmClearAll(false); setConfirmDeleteId(null); setEditingQueueId(null); }}
                      className="text-[11px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 font-medium transition-colors"
                    >Yes</button>
                    <button
                      onClick={() => setConfirmClearAll(false)}
                      className="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >No</button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
            {/* Queue items */}
            <div className="max-h-36 overflow-y-auto">
              {promptQueue.map((item, i) => {
                const isEditing = editingQueueId === item.id;
                const isConfirmingDelete = confirmDeleteId === item.id;

                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-800/40 last:border-0 group ${isEditing ? 'bg-zinc-800/40' : 'hover:bg-zinc-800/20'}`}
                  >
                    <span className="text-[10px] text-zinc-600 w-3.5 flex-shrink-0 text-right tabular-nums mt-1">{i + 1}</span>

                    {isEditing ? (
                      /* Edit mode */
                      <div className="flex-1 flex flex-col gap-1.5">
                        <textarea
                          autoFocus
                          value={editingQueueValue}
                          onChange={(e) => setEditingQueueValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              const v = editingQueueValue.trim();
                              if (v) updateQueueItem(item.id, v);
                              setEditingQueueId(null);
                            } else if (e.key === 'Escape') {
                              setEditingQueueId(null);
                            }
                          }}
                          rows={2}
                          className="w-full bg-zinc-900 border border-indigo-500/40 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none resize-none leading-relaxed"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              const v = editingQueueValue.trim();
                              if (v) updateQueueItem(item.id, v);
                              setEditingQueueId(null);
                            }}
                            className="text-[11px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                          >Save</button>
                          <button
                            onClick={() => setEditingQueueId(null)}
                            className="text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                          >Cancel</button>
                        </div>
                      </div>
                    ) : isConfirmingDelete ? (
                      /* Delete confirmation mode */
                      <div className="flex-1 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-zinc-400 truncate flex-1">{item.prompt}</span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[11px] text-zinc-400">Delete?</span>
                          <button
                            onClick={() => { removeFromQueue(item.id); setConfirmDeleteId(null); }}
                            className="text-[11px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 font-medium transition-colors"
                          >Yes</button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                          >No</button>
                        </span>
                      </div>
                    ) : (
                      /* Normal mode */
                      <>
                        <span className="flex-1 text-xs text-zinc-400 truncate mt-0.5">{item.prompt}</span>
                        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Edit button */}
                          <button
                            onClick={() => { setEditingQueueId(item.id); setEditingQueueValue(item.prompt); setConfirmDeleteId(null); }}
                            className="w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                            title="Edit"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Delete button */}
                          <button
                            onClick={() => { setConfirmDeleteId(item.id); setEditingQueueId(null); }}
                            className="w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* API Key collection card — shown when a third-party integration is detected */}
      {pendingKeyRequest && (
        <div className="mx-4 mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3.5 space-y-3 flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-300">{pendingKeyRequest.service}</span>
                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">{pendingKeyRequest.description}</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">API key required to complete this integration</p>
            </div>
            <button
              onClick={handleKeyRequestSkip}
              title="Skip and continue without key"
              className="flex-shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors text-sm leading-none mt-0.5"
            >
              ×
            </button>
          </div>

          {pendingKeyRequest.keys.map((keyDef) => (
            <div key={keyDef.envName} className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">{keyDef.name}</label>
              {keyDef.hint && (
                <p className="text-[10px] text-zinc-600">{keyDef.hint}</p>
              )}
              <input
                autoFocus
                type={keyDef.isSecret === false ? 'text' : 'password'}
                value={pendingKeyRequest.values[keyDef.envName] ?? ''}
                onChange={(e) =>
                  setPendingKeyRequest((prev) =>
                    prev
                      ? { ...prev, values: { ...prev.values, [keyDef.envName]: e.target.value } }
                      : prev
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleKeySubmit();
                  if (e.key === 'Escape') handleKeyRequestSkip();
                }}
                placeholder={keyDef.placeholder || ''}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500/60 font-mono transition-colors"
              />
            </div>
          ))}

          <div className="flex gap-2 pt-0.5">
            <button
              onClick={handleKeySubmit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Continue with key
            </button>
            <button
              onClick={handleKeyRequestSkip}
              className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Storage mode indicator */}
      <div className="border-t border-zinc-800/60 pb-2">
        <StorageSelector />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 flex-shrink-0">
        {/* Build / Ask mode toggle */}
        <div className="flex items-center gap-1 mb-2.5 relative">
          <button
            onClick={() => setChatMode('build')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 ${
              chatMode === 'build'
                ? 'border-indigo-500/60 text-indigo-300 bg-indigo-600/20'
                : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 bg-transparent'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Build
          </button>
          <button
            onClick={() => setChatMode('ask')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 ${
              chatMode === 'ask'
                ? 'border-amber-500/60 text-amber-300 bg-amber-600/20'
                : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 bg-transparent'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Ask
          </button>
          {chatMode === 'ask' && (
            <span className="ml-1 text-[10px] text-amber-500/70">answers only · no code changes</span>
          )}
          {/* Spacer */}
          <div className="flex-1" />
          {/* Memory indicator */}
          {hiddenCount > 0 && (
            <span
              title={`${hiddenCount} message${hiddenCount === 1 ? '' : 's'} kept as AI memory`}
              className="flex items-center gap-1 text-[10px] text-violet-400/70 px-1.5 py-0.5 rounded-md bg-violet-900/20 border border-violet-800/30"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {hiddenCount} in memory
            </span>
          )}
          {/* Clear conversation button */}
          {visibleMessages.length > 1 && !isGenerating && (
            <button
              onClick={() => setShowClearConfirm(true)}
              title="Clear conversation"
              className="flex items-center justify-center w-6 h-6 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
        {/* Clear confirmation dialog */}
        {showClearConfirm && (
          <div className="mb-3 p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 backdrop-blur-sm">
            <p className="text-xs text-zinc-300 mb-0.5 font-medium">Clear conversation?</p>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              The chat will be cleared but the AI will keep this conversation as memory for future prompts.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  clearVisibleMessages();
                  setShowClearConfirm(false);
                }}
                className="flex-1 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs font-medium transition-colors"
              >
                Clear chat
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Model selector */}
        <ModelSelector
          selected={selectedModel}
          isAutoMode={isAutoMode}
          onSelectModel={(m) => { setIsAutoMode(false); setSelectedModel(m); }}
          onSelectAuto={() => setIsAutoMode(true)}
          disabled={isGenerating}
        />

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.ts,.tsx,.js,.jsx,.css,.scss,.json,.md,.txt,.html,.py,.go,.rs,.java,.rb,.php,.yaml,.yml,.env.example"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att) =>
              att.type === 'image' ? (
                <div key={att.id} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-zinc-700/60 bg-zinc-800 flex-shrink-0">
                  <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-white text-lg"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-300 max-w-[160px]">
                  <svg className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate flex-1">{att.name}</span>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="flex-shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    ×
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <div className={`flex items-end gap-2 rounded-xl border bg-zinc-800/60 p-3 transition-colors ${
          isGenerating ? 'border-zinc-700' : 'border-zinc-700 focus-within:border-indigo-500/60'
        }`}>
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach image or file"
            className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors mb-0.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Dictation button */}
          {hasSpeechRecognition && (
            <button
              onClick={toggleDictation}
              title={isListening ? 'Stop dictation' : 'Dictate (voice to text)'}
              className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150 mb-0.5 ${
                isListening
                  ? 'text-red-400 bg-red-500/15 hover:bg-red-500/25'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {isListening ? (
                /* Pulsing mic-off icon while recording */
                <span className="relative flex items-center justify-center">
                  <span className="absolute w-5 h-5 rounded-full bg-red-500/20 animate-ping" />
                  <svg className="w-4 h-4 relative" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </span>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              chatMode === 'ask'
                ? 'Ask a question about your app or code...'
                : isGenerating
                ? 'Type to add to queue...'
                : 'Describe what to build, or paste a screenshot...'
            }
            rows={1}
            className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 text-sm resize-none outline-none leading-relaxed max-h-40 overflow-y-auto"
          />
          {/* Rewrite prompt button — shown when there's text in the input */}
          {input.trim() && (
            <button
              onClick={rewritePrompt}
              disabled={isRewriting}
              title="Improve my prompt with AI"
              className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150 mb-0.5 ${
                isRewriting
                  ? 'text-violet-400 bg-violet-500/15'
                  : 'text-zinc-500 hover:text-violet-400 hover:bg-violet-500/15'
              }`}
            >
              {isRewriting ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
                </svg>
              )}
            </button>
          )}
          {/* Stop button — cancels generation and reverts files */}
          {isGenerating && (
            <button
              onClick={() => cancelGeneration()}
              title="Stop and revert"
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 flex items-center justify-center transition-all duration-150"
            >
              <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() && attachments.length === 0}
            title={chatMode === 'ask' ? 'Ask' : isGenerating ? 'Add to queue' : 'Send'}
            className={`flex-shrink-0 w-8 h-8 rounded-lg disabled:opacity-40 flex items-center justify-center transition-all duration-150 ${
              chatMode === 'ask'
                ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700'
                : isGenerating
                ? 'bg-zinc-700 hover:bg-zinc-600'
                : 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700'
            }`}
          >
            {chatMode === 'ask' ? (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : isGenerating ? (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-zinc-600 text-[11px] mt-2 text-center">
          {chatMode === 'ask'
            ? 'Ask a question · Enter to send'
            : isGenerating
            ? 'Enter to queue · Shift+Enter for new line'
            : 'Paste or attach images · Enter to send'}
        </p>
      </div>
    </div>
  );
}

// ─── Plan Approval Card ────────────────────────────────────────────────────────

function PlanApprovalCard({ message }: { message: Message }) {
  const isGenerating = useStore(s => s.isGenerating);
  const { updateMessage } = useStore.getState();
  const approval = message.planApproval!;
  const plan = approval.plan;

  function handleApprove() {
    approvePlan(message.id);
  }

  function handleCancel() {
    updateMessage(message.id, {
      isStreaming: false,
      planApproval: { ...approval, status: 'cancelled' },
    });
  }

  return (
    <div className="mt-1 rounded-xl border border-zinc-700/50 bg-zinc-900/60 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/80">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/25 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-zinc-100 leading-tight">{plan.title || 'Build Plan'}</h3>
            <p className="text-[12px] text-zinc-400 mt-1 leading-relaxed">{plan.description}</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pt-3 pb-2 space-y-3">
        {/* Pages */}
        {plan.pages && plan.pages.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Pages</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {plan.pages.map(p => (
                <span key={p} className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-600/10 border border-indigo-500/20 text-[11px] text-indigo-300">{p}</span>
              ))}
            </div>
          </div>
        )}

        {/* Included features */}
        {plan.firstBuildScope && plan.firstBuildScope.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-emerald-500/70 uppercase tracking-wider">Included</span>
            <ul className="mt-1.5 space-y-1">
              {plan.firstBuildScope.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12px] text-zinc-400">
                  <svg className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Deferred */}
        {plan.deferredScope && plan.deferredScope.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Deferred</span>
            <ul className="mt-1.5 space-y-1">
              {plan.deferredScope.slice(0, 3).map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12px] text-zinc-600">
                  <svg className="w-3 h-3 text-zinc-700 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
                  </svg>
                  {item}
                </li>
              ))}
              {plan.deferredScope.length > 3 && (
                <li className="text-[11px] text-zinc-700 pl-4">+{plan.deferredScope.length - 3} more deferred</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      {approval.status === 'pending' && !isGenerating && (
        <div className="px-4 pb-4 pt-1 flex gap-2">
          <button
            onClick={handleApprove}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {plan.requestType === 'feature_add' ? 'Apply Changes' : plan.requestType === 'bug_fix' ? 'Apply Fix' : 'Generate App'}
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[13px] font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      {approval.status === 'pending' && isGenerating && (
        <div className="px-4 pb-4 pt-1">
          <div className="flex items-center gap-2 text-[12px] text-zinc-500">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            Processing…
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, onRePrompt, onFix, onImplement, onBuildFromAsk }: { message: Message; onRePrompt?: (content: string) => void; onFix?: (errorText: string) => void; onImplement?: (text: string) => void; onBuildFromAsk?: (prompt: string) => void }) {
  const [copied, setCopied] = useState(false);
  const isGenerating = useStore((s) => s.isGenerating);

  if (message.role === 'user') {
    const hasImages = message.imageAttachments && message.imageAttachments.length > 0;

    function handleCopy() {
      navigator.clipboard.writeText(message.content).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    return (
      <div className="flex justify-end mb-3 animate-slide-up group">
        <div className="max-w-[85%] space-y-1.5">
          {/* Image attachments above the text bubble */}
          {hasImages && (
            <div className="flex flex-wrap gap-2 justify-end">
              {message.imageAttachments!.map((img, i) => (
                <img
                  key={i}
                  src={img.dataUrl}
                  alt={img.name}
                  title={img.name}
                  className="max-w-[200px] max-h-[160px] rounded-xl object-contain border border-zinc-700/60 bg-zinc-900"
                />
              ))}
            </div>
          )}
          {message.content && (
            <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            </div>
          )}
          {/* Hover actions */}
          <div className="flex justify-end gap-1">
            <button
              onClick={handleCopy}
              title="Copy prompt"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
            {onRePrompt && message.content && (
              <button
                onClick={() => onRePrompt(message.content)}
                title="Re-send this prompt"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Re-prompt</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 mb-4 animate-slide-up">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex-shrink-0 flex items-center justify-center text-xs mt-1">
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        {/* Plan approval card — shown while awaiting user confirmation */}
        {message.planApproval?.status === 'pending' && (
          <PlanApprovalCard message={message} />
        )}
        {message.planApproval?.status === 'cancelled' && !message.pipeline && (
          <p className="text-xs text-zinc-500 mt-1">Generation cancelled.</p>
        )}

        {/* Pipeline progress card (shown while pipeline is running or complete) */}
        {message.pipeline && <PipelineCard pipeline={message.pipeline} />}

        {message.error ? (
          <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3 space-y-2.5">
            <div>
              <strong>Error: </strong>{(() => {
                try {
                  const parsed = JSON.parse(message.error!);
                  return parsed?.error?.message ?? parsed?.message ?? message.error;
                } catch {
                  return message.error;
                }
              })()}
            </div>
            {onFix && (
              <button
                onClick={() => {
                  const errorText = (() => {
                    try {
                      const parsed = JSON.parse(message.error!);
                      return parsed?.error?.message ?? parsed?.message ?? message.error!;
                    } catch {
                      return message.error!;
                    }
                  })();
                  onFix(errorText);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 hover:border-red-500/50 text-red-300 hover:text-red-200 text-xs font-medium transition-all duration-150"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Fix this error
              </button>
            )}
          </div>
        ) : (
          <div className="text-sm text-zinc-200 leading-relaxed">
            {!message.content && message.isStreaming && isGenerating ? (
              <TypingIndicator />
            ) : (
              <MarkdownContent
                content={message.content}
                isStreaming={!!message.isStreaming}
                onImplement={(!message.pipeline && !message.isAskResponse) ? onImplement : undefined}
                hideCode={(!!message.isAskResponse && !message.isStreaming) || (!!message.pipeline || !!message.isRepairMessage)}
                hideText={!!message.pipeline || !!message.isRepairMessage}
                noChips={!!message.isAskResponse}
              />
            )}
            {/* Build this button — shown on Ask-mode responses once streaming is done */}
            {message.buildIntent && !message.isStreaming && onBuildFromAsk && (
              <div className="mt-3 pt-3 border-t border-zinc-700/40">
                <button
                  onClick={() => onBuildFromAsk(message.buildIntent!)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all duration-150 shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Switch to Build mode &amp; start building
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Markdown Parser ──────────────────────────────────────────────────────────

type TextSegment = { type: 'text'; content: string };
type CodeSegment = { type: 'code'; lang: string; filename: string; content: string; isComplete: boolean };
type Segment = TextSegment | CodeSegment;

function parseContent(text: string): Segment[] {
  const segments: Segment[] = [];
  const lines = text.split('\n');

  let inCode = false;
  let codeLang = '';
  let codeFilename = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  for (const line of lines) {
    if (!inCode && line.startsWith('```')) {
      // Flush text
      if (textLines.length) {
        segments.push({ type: 'text', content: textLines.join('\n') });
        textLines = [];
      }
      const header = line.slice(3).trim();
      const parts = header.split(/\s+/);
      codeLang = parts[0] ?? '';
      codeFilename = parts.slice(1).join(' ') ?? '';
      codeLines = [];
      inCode = true;
    } else if (inCode && line.startsWith('```')) {
      // Close code block
      segments.push({ type: 'code', lang: codeLang, filename: codeFilename, content: codeLines.join('\n'), isComplete: true });
      inCode = false;
      codeLang = '';
      codeFilename = '';
      codeLines = [];
    } else if (inCode) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  }

  // Flush remaining
  if (inCode) {
    // Still streaming — show partial code block
    segments.push({ type: 'code', lang: codeLang, filename: codeFilename, content: codeLines.join('\n'), isComplete: false });
  } else if (textLines.length) {
    segments.push({ type: 'text', content: textLines.join('\n') });
  }

  return segments;
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

function MarkdownContent({ content, isStreaming, onImplement, hideCode, hideText, noChips }: { content: string; isStreaming: boolean; onImplement?: (text: string) => void; hideCode?: boolean; hideText?: boolean; noChips?: boolean }) {
  const segments = parseContent(content);

  // When code is hidden, collect all code segments to show as file chips
  const codeSegments = hideCode ? segments.filter((s): s is CodeSegment => s.type === 'code' && !!s.filename) : [];

  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          if (hideCode) return null;
          return (
            <CodeBlock
              key={i}
              lang={seg.lang}
              filename={seg.filename}
              code={seg.content}
              isComplete={seg.isComplete}
              isStreaming={isStreaming && !seg.isComplete}
            />
          );
        }
        if (hideText) {
          // Always show the last text segment if it comes after code blocks — this is the
          // completion summary (✅ Done! block) that the AI outputs after all file code blocks.
          const hasCodeBefore = segments.slice(0, i).some((s) => s.type === 'code');
          const isLastText = !segments.slice(i + 1).some((s) => s.type === 'text');
          if (hasCodeBefore && isLastText) {
            return <TextBlock key={i} text={seg.content} onImplement={onImplement} />;
          }
          return null;
        }
        return <TextBlock key={i} text={seg.content} onImplement={onImplement} />;
      })}
      {/* File chips — shown during AND after generation instead of raw code blocks */}
      {hideCode && codeSegments.length > 0 && !noChips && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {codeSegments.map((seg, i) => {
            const langColor: Record<string, string> = {
              tsx: 'text-cyan-400/70 bg-cyan-400/8 border-cyan-500/20',
              ts: 'text-blue-400/70 bg-blue-400/8 border-blue-500/20',
              css: 'text-pink-400/70 bg-pink-400/8 border-pink-500/20',
              json: 'text-orange-400/70 bg-orange-400/8 border-orange-500/20',
              sql: 'text-amber-400/70 bg-amber-400/8 border-amber-500/20',
            };
            const color = langColor[seg.lang.toLowerCase()] ?? 'text-zinc-500 bg-zinc-800/60 border-zinc-700/40';
            // The last segment is "currently writing" if it's incomplete (streaming)
            const isWriting = isStreaming && !seg.isComplete;
            return (
              <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono transition-opacity ${color} ${isWriting ? 'opacity-70' : 'opacity-100'}`}>
                {isWriting ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
                ) : (
                  <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {seg.filename || seg.lang}
              </span>
            );
          })}
        </div>
      )}
      {/* Blinking cursor at the end while streaming text (not when inside a code block) */}
      {isStreaming && segments.length > 0 && segments[segments.length - 1].type === 'text' && !hideCode && (
        <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  );
}

/** Render inline markdown: **bold**, *italic*, _italic_, `code` */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g).map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
      return <strong key={i} className="text-zinc-100 font-semibold">{seg.slice(2, -2)}</strong>;
    if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2)
      return <span key={i}>{seg.slice(1, -1)}</span>;
    if (seg.startsWith('_') && seg.endsWith('_') && seg.length > 2)
      return <em key={i} className="italic text-zinc-300">{seg.slice(1, -1)}</em>;
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2)
      return <code key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-300 font-mono text-xs">{seg.slice(1, -1)}</code>;
    return seg;
  });
}

// ─── Done! summary block ──────────────────────────────────────────────────────

function DoneBlock({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  const summaryLine = lines.find((l) => l.startsWith('✅'));
  const changedLine = lines.find((l) => /^Changed:/i.test(l));
  const worksLine = lines.find((l) => /^Works:/i.test(l));
  const noteLine = lines.find((l) => /^Note:/i.test(l));

  const summary = summaryLine?.replace(/^✅\s*Done!\s*/i, '').trim() ?? '';
  const changedRaw = changedLine?.replace(/^Changed:\s*/i, '').trim() ?? '';
  const worksText = worksLine?.replace(/^Works:\s*/i, '').trim() ?? '';
  const noteText = noteLine?.replace(/^Note:\s*/i, '').trim() ?? '';

  const changedFiles = changedRaw
    ? changedRaw.split(',').map((f) => f.trim()).filter(Boolean)
    : [];

  return (
    <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden text-[13px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-emerald-500/15 bg-emerald-500/8">
        <span className="text-base leading-none">✅</span>
        <span className="font-semibold text-emerald-300">{summary}</span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {/* Changed files */}
        {changedFiles.length > 0 && (
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 block mb-1.5">Changed</span>
            <div className="flex flex-wrap gap-1.5">
              {changedFiles.map((f) => {
                const ext = f.split('.').pop() ?? '';
                const colorMap: Record<string, string> = {
                  tsx: 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300',
                  ts: 'bg-blue-500/10 border-blue-500/25 text-blue-300',
                  jsx: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-300',
                  js: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-300',
                  css: 'bg-pink-500/10 border-pink-500/25 text-pink-300',
                  json: 'bg-orange-500/10 border-orange-500/25 text-orange-300',
                };
                const color = colorMap[ext] ?? 'bg-zinc-700/40 border-zinc-600/40 text-zinc-300';
                const short = f.includes('/') ? f.split('/').pop()! : f;
                return (
                  <span
                    key={f}
                    title={f}
                    className={`inline-flex items-center h-5 px-2 rounded-md border text-[11px] font-mono ${color}`}
                  >
                    {short}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Works */}
        {worksText && (
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 block mb-1">Works</span>
            <p className="text-zinc-300 leading-relaxed">{worksText}</p>
          </div>
        )}

        {/* Note */}
        {noteText && (
          <div className="flex items-start gap-2 pt-1 border-t border-zinc-700/40">
            <span className="text-amber-400 text-[11px] font-semibold uppercase tracking-wider shrink-0 mt-0.5">Note</span>
            <p className="text-zinc-400 leading-relaxed">{noteText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TextBlock({ text, onImplement }: { text: string; onImplement?: (text: string) => void }) {
  if (!text.trim()) return null;

  // Detect ✅ Done! block and render it with special formatting
  if (/✅\s*Done!/i.test(text) && /Changed:|Works:/i.test(text)) {
    return <DoneBlock text={text} />;
  }

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      elements.push(<hr key={idx} className="border-zinc-700/60 my-3" />);
      idx++;
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h3) {
      elements.push(
        <p key={idx} className="text-zinc-100 font-semibold text-[13px] mt-3 mb-1 first:mt-0">
          {renderInline(h3[1])}
        </p>
      );
      idx++; continue;
    }
    if (h2) {
      elements.push(
        <p key={idx} className="text-zinc-100 font-semibold text-sm mt-4 mb-1.5 first:mt-0">
          {renderInline(h2[1])}
        </p>
      );
      idx++; continue;
    }
    if (h1) {
      elements.push(
        <p key={idx} className="text-zinc-100 font-bold text-base mt-4 mb-2 first:mt-0">
          {renderInline(h1[1])}
        </p>
      );
      idx++; continue;
    }

    // Unordered list — collect consecutive items
    if (/^[*-] /.test(line)) {
      const items: string[] = [];
      while (idx < lines.length && /^[*-] /.test(lines[idx])) {
        items.push(lines[idx].slice(2));
        idx++;
      }
      elements.push(
        <ul key={`ul-${idx}`} className="space-y-1 my-1.5">
          {items.map((item, j) => {
            return (
              <li key={j} className="flex items-start gap-2 text-zinc-300 leading-relaxed">
                <span className="text-indigo-400 shrink-0 mt-px">•</span>
                <span className="flex-1">{renderInline(item)}</span>
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    // Ordered list — collect consecutive items
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (idx < lines.length && /^\d+\.\s/.test(lines[idx])) {
        items.push(lines[idx].replace(/^\d+\.\s/, ''));
        idx++;
      }
      elements.push(
        <ol key={`ol-${idx}`} className="space-y-1 my-1.5">
          {items.map((item, j) => {
            return (
              <li key={j} className="flex items-start gap-2 text-zinc-300 leading-relaxed">
                <span className="text-indigo-400 font-mono text-xs shrink-0 w-4 text-right mt-0.5">{num++}.</span>
                <span className="flex-1">{renderInline(item)}</span>
              </li>
            );
          })}
        </ol>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={idx} className="border-l-2 border-indigo-500/40 pl-3 text-zinc-400 italic my-1">
          {renderInline(line.slice(2))}
        </blockquote>
      );
      idx++; continue;
    }

    // Empty line — small spacer
    if (!line.trim()) {
      elements.push(<div key={idx} className="h-1.5" />);
      idx++; continue;
    }

    // Regular paragraph
    elements.push(
      <p key={idx} className="text-zinc-300 leading-relaxed">
        {renderInline(line)}
      </p>
    );
    idx++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

const LANG_COLORS: Record<string, string> = {
  tsx: 'text-cyan-400 bg-cyan-400/10',
  ts: 'text-blue-400 bg-blue-400/10',
  jsx: 'text-yellow-400 bg-yellow-400/10',
  js: 'text-yellow-400 bg-yellow-400/10',
  css: 'text-pink-400 bg-pink-400/10',
  json: 'text-orange-400 bg-orange-400/10',
  html: 'text-orange-400 bg-orange-400/10',
};

function CodeBlock({
  lang,
  filename,
  code,
  isComplete,
  isStreaming,
}: {
  lang: string;
  filename: string;
  code: string;
  isComplete: boolean;
  isStreaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const langColor = LANG_COLORS[lang.toLowerCase()] ?? 'text-zinc-400 bg-zinc-400/10';
  const displayName = filename || lang;

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-zinc-700/50 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-800/80 border-b border-zinc-700/40">
        <div className="flex items-center gap-2 min-w-0">
          {/* Language badge */}
          <span className={`text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded ${langColor}`}>
            {lang || 'code'}
          </span>
          {/* Filename */}
          {filename && (
            <span className="text-xs text-zinc-300 font-mono truncate" title={filename}>
              {filename}
            </span>
          )}
          {/* Streaming indicator */}
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-400">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              writing...
            </span>
          )}
          {/* Complete badge */}
          {isComplete && !isStreaming && (
            <span className="text-[10px] text-emerald-500">✓</span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
          {/* Copy button */}
          {isComplete && (
            <button
              onClick={copy}
              className="px-2 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors font-medium"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Code body */}
      {!collapsed && (
        <pre className="p-3 overflow-x-auto overflow-y-auto text-[11px] text-zinc-300 font-mono leading-relaxed max-h-60 scrollbar-thin">
          <code>{code}</code>
          {isStreaming && (
            <span className="inline-block w-0.5 h-3.5 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
          )}
        </pre>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-indigo-400 font-medium">Thinking</span>
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-indigo-400"
            style={{ animation: `thinkBounce 1.2s ease-in-out ${i * 0.18}s infinite` }}
          />
        ))}
      </div>
      <style>{`
        @keyframes thinkBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 text-zinc-400 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}

// ─── Pipeline Card ─────────────────────────────────────────────────────────────

const REQUEST_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  new_app:     { label: 'New App',  color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  feature_add: { label: 'Feature',  color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  redesign:    { label: 'Redesign', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  bug_fix:     { label: 'Bug Fix',  color: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

const STAGE_DISPLAY: Record<string, string> = {
  routing:        'Router',
  planning:       'Planner',
  generating:     'Generator',
  polishing:      'Polish',
  validating:     'Validator',
};

const MODEL_SHORT: Record<string, string> = {
  'gpt-4o':            'GPT-4o',
  'claude-opus-4-6':   'Claude Opus',
  'claude-sonnet-4-6': 'Claude',
  'gemini-2.5-flash':  'Gemini',
};

function StagePill({ stage }: { stage: PipelineStageInfo }) {
  const label =
    stage.name === 'generating' && stage.model
      ? MODEL_SHORT[stage.model] || stage.model
      : STAGE_DISPLAY[stage.name] || stage.name;

  if (stage.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-indigo-500/30 text-indigo-300 bg-indigo-500/10">
        <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-zinc-700/30 text-zinc-500 bg-zinc-800/30">
      <span className="text-emerald-500 text-[9px] leading-none flex-shrink-0">✓</span>
      {label}
    </span>
  );
}

function PipelineCard({ pipeline }: { pipeline: NonNullable<Message['pipeline']> }) {
  const { stages, plan, requestType } = pipeline;

  // Show a subtle "analyzing" state before the first stage event
  if (!stages || stages.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
        <span className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse" />
        Analyzing…
      </div>
    );
  }

  const allDone = stages.every((s) => s.status === 'done');
  const typeInfo = requestType ? REQUEST_TYPE_LABELS[requestType] : null;
  // Show all stages except 'routing' (it's reflected in the type badge)
  const visibleStages = stages.filter((s) => s.name !== 'routing');

  return (
    <div
      className={`mb-3 rounded-xl border p-3 space-y-2 transition-colors ${
        allDone ? 'border-zinc-800/40 bg-zinc-900/20' : 'border-zinc-700/40 bg-zinc-900/40'
      }`}
    >
      {/* Type badge + stage pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {typeInfo && (
          <>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${typeInfo.color}`}
            >
              {typeInfo.label}
            </span>
            {visibleStages.length > 0 && (
              <span className="text-zinc-700 text-xs select-none">·</span>
            )}
          </>
        )}

        {visibleStages.map((stage, i, arr) => (
          <span key={i} className="flex items-center gap-1.5">
            <StagePill stage={stage} />
            {i < arr.length - 1 && (
              <span className="text-zinc-700 text-[10px] select-none">→</span>
            )}
          </span>
        ))}

        {/* "Starting" fallback when routing is the only stage */}
        {visibleStages.length === 0 && (
          <span className="flex items-center gap-1 text-[11px] text-zinc-600">
            <span className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse" />
            Starting…
          </span>
        )}
      </div>

      {/* Plan description */}
      {plan?.description && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          {plan.description
            .replace(/^I built\b/i, "I'll build")
            .replace(/^I created\b/i, "I'll create")
            .replace(/^I designed\b/i, "I'll design")
            .replace(/^I made\b/i, "I'll make")
            .replace(/^I developed\b/i, "I'll develop")
            .replace(/^I implemented\b/i, "I'll implement")
          }
          {plan.pages && plan.pages.length > 0 && (
            <> · <span className="text-zinc-600">{plan.pages.join(', ')}</span></>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Model Selector ────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; role: string; activeClass: string; dotClass: string }[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    role: 'Core Generator',
    activeClass: 'border-emerald-500/60 text-emerald-300 bg-emerald-600/20',
    dotClass: 'bg-emerald-400',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude',
    role: 'Design Enhancer',
    activeClass: 'border-indigo-500/60 text-indigo-300 bg-indigo-600/20',
    dotClass: 'bg-indigo-400',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini',
    role: 'Fast Experiments',
    activeClass: 'border-sky-500/60 text-sky-300 bg-sky-600/20',
    dotClass: 'bg-sky-400',
  },
];

function ModelSelector({
  selected,
  isAutoMode,
  onSelectModel,
  onSelectAuto,
  disabled,
}: {
  selected: ModelId;
  isAutoMode: boolean;
  onSelectModel: (m: ModelId) => void;
  onSelectAuto: () => void;
  disabled: boolean;
}) {
  const activeModelMeta = MODELS.find((m) => m.id === selected);

  return (
    <div className="flex items-center gap-1.5 mb-2.5">
      {/* Auto pill */}
      <button
        onClick={onSelectAuto}
        disabled={disabled}
        title="Automatically pick the best model based on your message"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
          isAutoMode
            ? 'border-violet-500/60 text-violet-300 bg-violet-600/20'
            : 'bg-transparent border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isAutoMode ? 'bg-violet-400 animate-pulse' : 'bg-zinc-600'}`} />
        Auto
        {/* Show which model was auto-picked */}
        {isAutoMode && activeModelMeta && (
          <span className={`text-[9px] font-normal opacity-60 ${activeModelMeta.activeClass.split(' ')[1]}`}>
            → {activeModelMeta.label}
          </span>
        )}
      </button>

      {/* Divider */}
      <span className="w-px h-4 bg-zinc-700 flex-shrink-0" />

      {/* Individual model pills */}
      {MODELS.map((m) => {
        const isActive = !isAutoMode && selected === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onSelectModel(m.id)}
            disabled={disabled}
            title={`${m.label} — ${m.role}`}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              isActive
                ? m.activeClass
                : 'bg-transparent border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? m.dotClass : 'bg-zinc-600'}`} />
            {m.label}
            {isActive && (
              <span className="text-[9px] opacity-60 font-normal hidden sm:inline">{m.role}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
