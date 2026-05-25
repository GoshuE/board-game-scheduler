# Google Sheets setup

This app uses a Google Apps Script Web App as a small public API in front of a Google Sheet.

## Setup

1. Create a new Google Spreadsheet.
2. Open `Extensions` -> `Apps Script`.
3. Paste the contents of `gas/Code.gs` into the script editor.
4. Deploy as a Web App.
   - Execute as: `Me`
   - Who has access: `Anyone`
5. Copy the Web App URL.
6. Paste that URL into `GOOGLE_SCRIPT_URL` in `index.html`.
7. If you set `APP_KEY` in `Code.gs`, set the same value in `GOOGLE_SCRIPT_KEY` in `index.html`.

## Data

The script creates a hidden `State` sheet and stores one JSON payload in cell `A1`.
The app updates that payload through actions such as `setVote`, `addComment`, `setDecided`, and `reset`.

## Members

Members are fixed in both `index.html` and `gas/Code.gs`:

- 郷朱
- 彩乃
- 純子
- 政比呂
- 未紗

Only 郷朱 can decide or reset dates.

## Current deployment

- Spreadsheet: https://docs.google.com/spreadsheets/d/1hRGTXku0-RVBE5rHx45oce1qwW_LGu2ARb4ci3Deb08/edit
- Web App: https://script.google.com/macros/s/AKfycbxio5P6XlqOLwhsH8wl7kRcqjpOMdrbQkhRMLAtGHuYEQt11ULVF72aIo9ErB0J7IKdUw/exec
