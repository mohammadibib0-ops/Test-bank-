# TestBank (Professional Version)

This project is a secure, sellable test bank web app:
- Teacher admin dashboard
- Upload a question set (JSON)
- Generate access codes
- Each code is locked to ONE device (server-enforced)
- Students can take tests on computer or phone (Android/iOS browser)
- SQLite database included

## Important (questions)
This project ships WITHOUT copyrighted question content.
You can upload your own question set JSON in the Admin panel.

## Quick Start (Small Setup)

### Option 1: Local (Node installed)
1) Install **Node.js LTS**
2) Unzip this folder
3) Start the server:
   - Windows: double-click `start_windows.bat`
   - Mac/Linux: run `./start_mac_linux.sh`
4) Open `client/index.html` in your browser (or serve it with any static host)
5) In the top bar, set API Base to: `http://localhost:8080`

Default admin credentials are in `server/.env` (you can change them).

### Option 2: Deploy (recommended)
Host the **server** on any Node host (Render/Fly/Heroku/VPS).
Host the **client** on any static host (Netlify/Vercel/S3).
Set `CORS_ORIGIN` in `server/.env` to your client URL.

## Question set JSON format

{
  "meta": {
    "durationMinutes": 60,
    "shuffleQuestions": true,
    "showScoreAfterSubmit": true
  },
  "questions": [
    {
      "id": "Q1",
      "text": "Question text...",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 2,
      "explanation": "optional"
    }
  ]
}

## Teacher admin actions
- Upload question set JSON
- Generate codes (copy/paste to students)
- Reset device lock for a code
- Disable a code
- View attempts
