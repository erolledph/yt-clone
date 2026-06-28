* Instructions for using this frontend

To use this frontend:
1. Ensure the backend API (yt-api) is running locally on port 3000
2. Open index.html in your browser
3. Use the search bar to search for YouTube channels
4. Click on videos to play them

Features:
- Browse videos, shorts, streams, and live content
- Custom video player with controls
- Responsive design
- Search functionality
- Channel filtering

Backend API endpoints used:
- GET /channel - Get all channel data
- GET /channel/videos - Get channel videos
- GET /channel/shorts - Get channel shorts
- GET /channel/streams - Get channel streams
- GET /channel/isLive - Check if channel is live
- GET /info - Get channel info

Development Commands:
- npm run build (build backend)
- npm start (start backend + this frontend)
- npm test (run API tests)

Note: This frontend requires the yt-api backend to be running.
The backend should be built and running on port 3000.
