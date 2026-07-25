# Privacy Policy for patens

**Last Updated:** July 25, 2026

patens is an open-source, local-first memory layer designed to bridge the gap between your web browser and your local IDE. Because our core philosophy is built around local execution, our privacy policy is incredibly simple: **Your data is yours, and it never leaves your machine.**

This Privacy Policy explains exactly what data the patens Chrome Extension processes, how it processes it, and what we explicitly do not do.

## 1. What Data We Process (The "Do"s)

To function as a context clipboard, the patens Chrome Extension must process certain information when you actively use it:

*   **Website Content:** When you highlight text on a webpage and trigger the capture command (via keyboard shortcut or context menu), the extension reads only the specifically highlighted text.
*   **Web History (URLs & Titles):** When capturing your highlighted text, the extension also reads the URL and the Title of the current active tab. This is used strictly to provide automatic attribution and source-linking in your local AI context files.
*   **Local Storage:** The extension uses your browser's local storage to temporarily hold your clipped text (your "cart") and to save your extension preferences (like custom keyboard shortcuts).

## 2. How Your Data is Processed

**100% Local Execution:** 
When you click "Send to Local Memory" or trigger a capture, the extension makes a local network request (`fetch`) directly to `http://localhost:8000`. This is the patens desktop server running locally on your own hardware. 

The data is vectorized and saved into a local SQLite database (sqlite-vec) stored entirely on your computer's hard drive. 

## 3. What We DO NOT Do (The "Don't"s)

We believe developer tools should not spy on developers. We guarantee the following:

*   **No Cloud Storage:** We do not own, operate, or rent any cloud servers for data processing. Your captured text, URLs, and code snippets are never transmitted over the internet to us or any third party.
*   **No Passive Scraping:** The extension only reads the active tab's data when you explicitly trigger a capture command. It does not monitor your browsing history in the background, track what websites you visit, or log your keystrokes.
*   **No Telemetry or Analytics:** We do not embed Google Analytics, tracking pixels, or any telemetry software in the extension or the local server. We do not track how many times you use the tool.
*   **No Data Selling or Sharing:** Because we do not collect your data, it is impossible for us to sell, share, or transfer it to advertisers, data brokers, or third-party companies.

## 4. Chrome Extension Permissions Explained

To maintain total transparency, here is exactly why the extension requests the following permissions:
*   `activeTab` & `scripting`: Required to read the text you have highlighted on the page you are currently viewing.
*   `tabs`: Required to fetch the URL and page title of your current tab for sourcing.
*   `storage`: Required to save your current clip "cart" locally before you send it to your local server.
*   `contextMenus`: Required to add the "Save to patens" option when you right-click on a webpage.
*   `*://*/*` (All URLs): Required because developers research on a vast, unpredictable variety of websites (documentation, forums, GitHub, etc.). This permission allows the capture tool to work on any page you visit.

## 5. Contact Us

patens is fully open-source. You can verify all of these claims by reading our source code directly.

If you have any questions or concerns about this privacy policy, please open an issue on our GitHub repository at [https://github.com/Patens-dev/Patens](https://github.com/Patens-dev/Patens).