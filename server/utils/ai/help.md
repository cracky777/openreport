# OpenReport user guide

## journey — Getting around: Data Sources, Data Models, Reports
- OpenReport works in three stages, left to right: Data Sources (connections) → Data Models (the fields people report on) → Reports.
- The stage switcher in the top header shows Data Sources, Data Models and Reports. Viewers only see Reports; Data Sources and Data Models are for admins and editors.
- Alt+← / Alt+→ moves between stages. On a wide screen you can also click the neighbouring column that peeks in at the edge.
- Overview (eye icon right of the stage switcher, wide screens): shows Data Sources, Data Models and Reports side by side, zoomed out to fit the screen, with the joins between them and without the cards' buttons. Click a column to open that stage; Esc or the same icon goes back.
- Lines between cards show which model uses which source and which report uses which model. Clicking the name or the count on a line opens the next stage and highlights that branch: everything it is linked to stays as is, the rest is greyed out (nothing is hidden), and the column scrolls to the first highlighted card. The crumb at the top (Highlighting …) switches to another branch or clears it with its ×. The + at the end of a card creates on it (a model on a source, a report on a model) without highlighting anything.
- The workspace picker (folder icon, top-left, next to the logo) chooses between My Reports and the workspaces you belong to. Every stage follows it: Data Sources and Data Models show what lives in the open workspace (or is shared into it), Reports shows its reports. An app admin also sees, apart, the workspaces they hold no role in.
- Top-right: your user menu (the account pill). It opens on Alerts (admins and editors), Admin (admins only), the theme, API tokens, Report a bug and Logout.
- Right edge: the Assistant bar (if the AI assistant is available to you) — click it to open or close the Assistant panel.

## roles — Roles and who can do what
- Every account has an app role: Admin (full access + user management), Editor (create/edit reports, models, datasources) or Viewer (view reports only).
- The first account registered on an instance becomes the admin; later sign-ups are viewers until an admin changes their role (Admin → Users).
- Inside a workspace, members also have a workspace role: Admin, Editor or Viewer. A viewer opens the workspace's reports. An editor also sees its data sources and data models, creates models on its sources, edits its models and builds reports. A workspace admin also adds data sources (and holds their credentials), deletes, moves and shares models, sets row-level security and drives the cache.
- Data sources and data models live in one workspace each (My Reports is your personal one, and shows only what lives there). A new workspace holds none: a source or a model reaches it by being created there, moved there, or shared into it.
- App admins manage everything — every workspace, source, model and report — but they read data only where a workspace gave them a role: without one, a report's visuals stay empty for them and row-level security is not bypassed.

## workspaces — Workspaces and sharing with colleagues
- My Reports holds your personal reports. A workspace is a shared folder of reports with its own members.
- Create one (admins and editors): workspace picker → New workspace → type a name → + (Create).
- Add people: open the workspace picker → click the gear icon at the end of the workspace's row (its settings) → under Members type an Email address, choose Viewer, Editor or Admin, click the add-member button.
- Only a workspace admin can rename the workspace, change member roles, remove members or delete it. Deleting a workspace moves its reports, data sources and data models back to their creators' My Reports.
- Move a report into a workspace: on its card, More actions (⋮) → Move to workspace → pick the target → Move.
- Share a report with other workspaces: on its card, More actions (⋮) → Share report → tick the workspaces → Save. It shows there with a "shared" badge: their members open it and see its data, and their admins and editors work on it as on their own (it is the same report, not a copy): Edit and the whole More actions (⋮) menu — Duplicate puts the copy in the open workspace. Only deleting it stays with its own workspace. What exposes its data model still needs rights on the model: publishing or embedding it needs write access to the model, and moving or copying it somewhere needs its model to be available there. The report's model must be available in each of them (its home, or shared into it), unless you manage the model.
- Share a data source with another workspace (its editors can then create models on it; its credentials stay with its own workspace): Data Sources stage → share icon on the source card → tick the workspaces → Save. It shows there with a "shared" badge. Sharing a data model never shares its data source: the source reaches another workspace only when it is shared itself.
- Share a data model with another workspace (its editors can then build reports on it, nobody there edits it): Data Models stage → More actions (⋮) on the model card → Share → tick the workspaces → Save. Move a model or a data source to another workspace: the arrows icon on its card → pick the target → Move.
- Custom visuals are only available to reports that live in a workspace.

## datasources — Connecting a database
- Who: an admin of the open workspace (My Reports: you). Where: Data Sources stage → + New Connection. The source lands in the open workspace.
- A source marked "shared" is shared into the open workspace: create models on it, its settings belong to its own workspace. One marked "read-only" is shown because a model that lives in this workspace, and that you edit, reads it. A dashed card with a lock ("Not shared with this workspace") is the source of a data model shared here: it shows where the model comes from, but it is not shared — ask its workspace admin to share it to build models on it.
- On a source card (workspace admins): edit the connection or re-import the file, Share with other workspaces…, Move to another workspace, Delete; the + creates a model on it (editors).
- Supported: PostgreSQL, Azure PostgreSQL, Redshift, MySQL, Oracle, Azure SQL, SQL Server, BigQuery, Snowflake, Databricks, ClickHouse, DuckDB.
1. Click + New Connection, choose the type and fill in host, port, database, user and password (fields change with the type; e.g. SSL, TLS, named instance).
2. Click Test Connection until it says "Connection successful!".
3. Click Save.
- Edit later with the pencil (Edit connection) on the card. A data source used by a model cannot be deleted until those models are deleted.
- The + on a data source card creates a data model on it.
- DuckDB: pick a database file (.duckdb, or a SQLite .db/.sqlite file); every table in it becomes a table of the source, and the button reads Import.

## file-upload — Importing a file (CSV, Excel, Parquet, JSON)
- Who: admins and editors. Where: Data Sources stage → Import file.
- Accepted: .csv, .tsv, .xlsx, .xls, .parquet, .json, and SQLite/DuckDB database files.
1. Click Import file and choose the file.
2. Adjust the import options (for Excel, pick at least one sheet).
3. Click Import. The file becomes a data source you can build a model on.
- To refresh a file source with a newer version, click the upload icon on its card ("Import a newer … into this source") → Refresh data. When the source holds several files, pick the one to replace; the others are kept. Models and reports are kept; a column missing from the new file shows as a broken reference.
- Several files in one model: each imported file is a data source of its own, and a model on an imported file can read other imported files too, joining their tables like tables of one database. In New Data Model, pick the first file as Data Source, then "Also use:" → Add a data source… (another imported file) or + Import a file. In the model editor, Select Tables step: the Sources line lists the model's files — + Import a file creates a new source and adds it (its tables come in already ticked), Add a data source… adds an existing one, × removes one (once none of its tables is in the model). Tables of an added file are listed under its name. The journey draws a line from each source to the model. A file and a database connection cannot be combined in one model.
- You can also start from a file when creating a report: Reports → + New Report → Import File (max 500 Mo).

## models — Building a data model (tables and joins)
- Who: an admin or editor of the open workspace. Where: Data Models stage → + New Model (or the + on a data source card). The model lands in the open workspace.
1. Enter a Name, pick the Data Source, optional description → Create & Configure.
2. Step 1. Tables: tick the tables you need → Next: Schema & Joins →.
3. Step 2. Schema & Joins: drag from one column's dot to another table's column dot to create a join. Click a join's cardinality to toggle it; Remove join deletes it. Tables added from a database arrive already joined by the foreign keys the database declares. The Detect relationships button (top-left of the diagram) also joins tables by key column names — customer_id, id_customer, FK_customer, CustomerID point at the customer (or customers, dim_customer) table's id — from fact to dimension tables, marks as fact or dimension the tables that had no role, and says what it left out: a join that would make a loop, a second path between two tables, or point at a fact table. A join must link columns of the same kind: joining a text column (a name) to a number (an id) draws a dashed amber line with a warning, and the model shows it under broken references — reports on it fail. Link the key columns of both tables instead (e.g. articles.id_article → ventes.article).
4. Flag columns with the D (dimension) or M (measure) tag next to each column. Without flagged columns reports have nothing to show.
   To find a field, click the magnifier at the left end of a table's FACT / DIM bar on the diagram and type in "Search fields…": the table shows only its matching columns. "D all" / "M all" next to it flag every match of that table as a dimension / measure at once (click again to unflag them all). Escape or the magnifier closes the search.
5. Step 3. Dimensions & Measures: rename labels, set types and date formats, add calculated fields.
6. Click Save (top-right). + New Report saves the model and opens a new report on it.
- The datasource badge in the header lets you switch the model to another data source (Change datasource); broken references are listed with a Re-check button.
- The model assistant (sparkles button in the model editor header, for the model's owner or an admin, when the AI assistant is available) can propose the joins, which columns are dimensions or measures, new measures (sum, average, count, distinct count, min, max of a column), which tables are facts or dimensions, and arrange the diagram. Review the card, click Apply, then Save the model. It does not write SQL: calculated fields stay manual.
- On a model card: Edit model, Refresh the cache and Delete model; More actions (⋮) holds Incremental cache refresh, Export data model (a .model.yaml file), Share (with other workspaces) and Move to workspace; the + adds a report on it. What shows follows your role: an editor edits and exports, a workspace admin has everything, a model shared into the workspace (badge "shared") offers only the +.

## fields — Dimensions, measures and calculated fields
- Dimensions are what you group or filter by (text, dates…); measures are columns that get aggregated (sum, average, count, distinct count, min, max): any column can be one, a text or a date through its count, min or max.
- In the model editor, step 3 (Dimensions & Measures):
  - + Dimension → New calculated dimension: Label, the table it belongs to, a type (string, integer, decimal, date, boolean) and a SQL expression → Add.
  - + Measure → New calculated measure: Label and a SQL expression → Add. Edit (on a SQL measure's row) reopens the same form to change its label or SQL; the measure keeps its name, so the visuals bound to it follow.
  - Period (a column of the measures table): the same measure over the report's date selection moved back — Previous year, quarter, month or day. Current = no shift. The N-1 button on a row adds a shifted copy of that measure ("Amount (N-1)") so the two can sit side by side in a visual; an evolution is then a SQL measure such as (${amount} - ${amount_prev_year}) / NULLIF(${amount_prev_year}, 0). The shift follows the date filters of the report (slicers, year, time window); with no date filter the shifted measure equals its base. It needs a date dimension in the model.
- In the report editor, the Data panel (right) also has + Measure and + Dimension. These fields belong to the report only (measure: Label, SUM/AVG/COUNT/COUNT DISTINCT/MIN/MAX or Custom SQL, optional Add filter and Override report filters). Use Promote to model to make one available to every report on the model.
- In a visual's field well, click a measure to change its aggregation, or add a time-windowed copy (YTD, last 30 days…).

## rls — Row-level security (RLS)
- Who: the model's owner or an admin, in the model editor, step 2 (Schema & Joins).
1. Click the RLS badge on the table that decides access (e.g. a customers or regions table).
2. In Row-level security, pick the RLS value column.
3. For each row, add patterns: an email, a wildcard pattern (*@company.com, alice@*), * for any signed-in user, or group:name for an admin-defined group.
4. Tick Enable RLS for this table, then Save the model.
- A row with no rule is seen by nobody (except the model owner and admins). Only one table per model carries RLS, and it must be joined to the tables being queried.
- Groups are managed in Admin → Groups.

## reports — Creating and managing reports
- Who: admins and editors (and workspace admins/editors inside a workspace). Where: Reports stage → + New Report.
1. Type a Title.
2. Pick the data: Existing Model, Import File (CSV, Excel, Parquet, JSON) or Connect Database.
3. With an existing model: choose the Model → Create Report. The editor opens.
- On a report card: View (opens the viewer in a new tab), Edit, More actions (⋮), and delete.
- More actions (⋮): Rename, Duplicate, Export report, Move to workspace, Share report, Share public link / Make private, Copy public link, Embed…, History (admins), Schedule refresh, Alerts…, and the Rollup cache / Live query switch (admins).
- Viewers only get View.

## editor — The report editor toolbar
- Left: Back, Undo, Redo, the report title (click to rename).
- Middle: the widget palette — Bar Chart, Line Chart, Combo Chart, Pie Chart, TreeMap, Scatter Chart; Table (and Pivot Table), Scorecard, Gauge; Filter; Shapes (Text, Image, Line, Square, Round, Arrow); Custom visuals (workspace reports only).
- Right: Refresh data (Live query or Cache), Edit interactions, AI assistant (when available), Report settings, Export, Preview, Save.
- Right-hand panels: the property panel of the selected visual, and the Data panel with the model's Dimensions and Measures (collapsible).
- Shortcuts: Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, Ctrl+C / Ctrl+V copy-paste a widget, Delete removes the selected widget, arrow keys nudge it (Shift = ten steps).
- Preview opens the last saved version in a new tab; with unsaved changes it offers Save and preview.

## visuals — Adding visuals, text, images and shapes
1. Click a widget in the toolbar palette. Types with a ▼ (Bar, Line, Combo, Table, Gauge, Filter) open a sub-menu: e.g. Clustered Bar, Stacked Bar, 100% Stacked Bar; Line, Area, Stacked Area; Line + Stacked Bar; Arc Gauge, Column Gauge; Table, Pivot Table.
2. Drag dimensions and measures from the Data panel into the visual's field wells (Axis, Values, Legend…).
3. Move and resize it on the canvas. With a widget selected, the small bar above it offers Send to back, Backward one, Forward one, Bring to front.
- Text: Shapes → Text, then double-click it to type; the toolbar offers Bold, Italic, Underline, Font size, Font, Color, Clear formatting. To print a measure inside the text: drop the measure (or a dimension, read as Max of its column) in the Measures well of the Text's Fields section, then write its #tag in the text (the panel lists the tags, e.g. #revenue, #category_max); the value follows the report's filters and slicers. Dropping a field straight onto a Text visual binds it and appends its #tag.
- Image: Shapes → Image, then in its panel paste a URL or use Upload (upload is not available in the cloud edition), and choose Fit.
- Line, Square, Round, Arrow are decorative shapes.
- On a widget: View the SQL query, Refresh this widget's data, Cancel query (while loading).

## property-panel — Configuring a visual (property panel)
- Select a visual; its panel shows a title field ("Add a title…"), the type, row count, Delete widget, and the same sections in this order:
- Fields: the drop zones (Axis/Category/Rows/Columns, Values, Legend…; Scorecard has Value and Compare with (date)). A field can also be dropped straight onto the visual: the overlay names the well it will fill and lists the other wells that take it, drop on one of them to aim. A dimension dropped in Values becomes a measure of its column, Max by default; click the aggregation on the chip to pick Count, Distinct, Min, Max (Sum and Avg on numbers).
- Filters: rules that only affect this visual (Add filter), and Top N for bar, pie and treemap.
- Data: Time period (Date dimension + Period), Row limit, When empty message; on a scorecard with a Compare with (date), the Comparison lines (N-1 value, N vs N-1, % evolution).
- Then the visual's own section (named after its type: smooth lines, donut, totals, slicer style…), Colors (series, gradient, Color by rule), Labels (data labels, number format; on a scorecard the value's weight and, for a date value, its Date format), Axes (each axis with its line color, title, font and, for the X axis, the label angle; the grid's line style, width and color), Legend, Frame (title font and title color, border, background, shadow).
- A section that does not apply to the visual is not shown.

## sorting-topn — Sorting, Top N, row limit, time periods, year-over-year
- Sort: in a filled field well (Fields section) use the Sort buttons: No sort, Ascending, Descending.
- Top N: Filters section → Top N → tick Show Top N + Others, then set N. Items beyond N are grouped into one "Others" bucket. Available on Bar, Pie and TreeMap.
- Row limit: Data section → Row limit (default 1000).
- Time period: Data section → Time period → pick a Date dimension and a Period (Year to date, Quarter to date, Month to date, Last 7/30/90 days, Last 12 months, Previous month/quarter/year).
- Scorecard vs last year: drop a date in Compare with (date), then in Data → Comparison tick N-1 value, N vs N-1 or % evolution. The % line divides the change by the previous period; open it and set Divide by → Selected period (N) to read the change against the period on screen.

## filters — Filters: slicers, report filters and visual filters
- Slicer on the page: toolbar Filter ▼ → Visual Filter, then drop a dimension in its Field. Its section sets the Style: List, Dropdown, Buttons, Range, and for dates Date range, Relative date, Calendar. Filters (Restrict values) limits the values it offers.
- Report filters (apply to every visual of the report): Filter ▼ → Global filter shows the Report filters bar → + (Add a report filter) → type to search a field, click it or press Enter → set the rule → Save (applies on next refresh) or Save & refresh. A field dragged from the Data panel and dropped on the bar starts a rule on it the same way.
- Click a report-filter chip to edit it, the hand icon to choose which widgets it applies to, × to remove it. Hiding the bar keeps the filters active.
- Visual-only filters: the visual's Filters section → Add filter (dimensions or measures).

## interactions — Cross-filtering and drill-down
- Cross-filter: clicking a bar, slice or point filters the other visuals of the page; click it again to clear. Works in the editor and the viewer.
- Edit interactions (hand icon in the toolbar): select a source widget first, click Edit interactions, then on each other widget toggle Filter or None to decide whether it reacts. Click the icon again to exit.
- Drill-down: on a Bar, Line, Combo, Pie or TreeMap chart with more than one dimension in its axis/category well, clicking a value drills to the next level. Drill up and Reset drill buttons appear on the widget.

## pages — Pages and page navigation
- The pages column sits beside the canvas. Add page (+) adds one.
- Right-click a page for Rename, Duplicate, Delete; double-click its name to rename.
- Customize navigation opens Page Navigation (position, colours, fonts, header title/logo, per-page image). Collapse navigation / Expand navigation hide or show the column.

## report-settings — Report settings, themes and layout
- Where: editor toolbar → Report settings (gear).
- Report Theme: Light or Dark for this report.
- View Mode: Actual size, Fit to width, Fit to page.
- Small Screens (what phones see): Stack widgets or Scale the page.
- Page Size (width/height in px), Canvas (Snap to grid, Grid size, Show grid), Background (colour, transparent, image), Around the report, Report Border.
- Your own app theme (System, Light, Dark) is in the user menu → Theme; it is separate from the report theme.

## saving — Saving, undo and version history
- Click Save (top-right of the editor). Leaving with unsaved changes asks: Cancel, Leave without saving, Save and leave.
- Undo / Redo: toolbar arrows or Ctrl+Z / Ctrl+Y. An applied AI proposal is one undo step.
- Version history (app admins only in the open-source edition): Reports stage → report card → More actions (⋮) → History. It lists the 20 most recent saves; Restore brings one back, and the current state is saved first, so a restore can itself be undone.
- Duplicate (More actions) makes a copy of a report.

## custom-visuals — Custom visuals
- Available only for reports inside a workspace. Where: editor toolbar → Custom visuals (puzzle icon).
- Any member can insert an installed visual from that menu.
- Workspace admins can Upload custom visual (.zip), Download starter template, and delete a visual (Delete custom visual). The library is shared by all reports of the workspace.
- Visuals OpenReport ships (currently Sankey: source, target, weight, optional colour category) are listed in the same flyout as "built-in · install" for a workspace admin; installing one adds it to the library and drops it on the canvas.
- The AI assistant can also write a new visual; only a workspace admin can add it to the library (see ai-editor).

## schedules — Scheduling a report
- In the open-source edition, "scheduling a report" means scheduling a refresh of its cache (rollups); it does not send emails.
1. Reports stage → report card → More actions (⋮) → Schedule refresh.
2. + New schedule → Run every day at (time) and Timezone → Save.
3. For several runs a day, create one schedule per time slot.
- Each schedule can be run now (play icon), paused/resumed, or deleted. The list shows the last run and any error.
- Who: the report's owner or an app admin, and they also need write access to its data model.
- A refresh rebuilds the cache of the report's data model, so every report on that model benefits.
- Emailed reports: More actions → Schedule email exists only in the cloud edition (name, time, timezone, recipients, subject, message, per-recipient filter rules, optional RLS). It sends the report as a PDF. It is not available in the open-source edition.
- The AI assistant can also create it for you: ask it to schedule the report (it can also run hourly, weekly or monthly, which the screen above cannot), check the card it shows, pick the report in the Assistant panel, and click Schedule. Nothing is created before that click.
- To be notified when a number crosses a threshold, use Alerts instead.

## alerts — Alerts on a measure
- Who: admins and editors. Where: user menu (top-right) → Alerts, or a report card → More actions → Alerts… (pre-selects its model).
1. Click + New Alert.
2. Fill Name, Model, Measure, optional Filters (scope the measure — recommended), Condition (>, >=, <, <=, =, !=) and Threshold.
3. Choose Check: Every 5 minutes, Every 15 minutes, Every hour, Every 6 hours, Every day at 08:00.
4. Optional Webhook URL (Slack/Teams/Discord compatible) and "Also notify when the value recovers" → Save.
- Each alert shows its state (OK, Triggered, Error, Never run) and a history link. Buttons: Check now, Edit alert, Pause/Resume, delete.
- An alert runs as its creator, so row-level security applies. Admins see every alert (Admin → Alerts).
- Email recipients for alerts exist only in the cloud edition.

## rollup-cache — The rollup cache
- By default a report's visuals are served from the rollup cache: pre-aggregated tables built from the source database, much faster than live queries. A visual the cache cannot serve falls back to a live query.
- Build or rebuild it:
  - In the editor: Refresh data ▼ → Cache (save first; unsaved widgets are not in the plan). Refresh data ▼ → Live query re-queries the source without rebuilding.
  - On the Data Models stage: the refresh icon on a model card ("Refresh the cache") rebuilds the rollups shared by every report on that model.
  - On a schedule: see schedules.
- Incremental cache refresh… (model card): pick a Date column and a Window (Last N months) so only recent data is rebuilt; Off = full rebuild.
- Who can build: the model's owner or an app admin.
- A report card shows "cache <size> · <rows> rows" once built; click it to see the rollups (grain, measures, rows, size, built). People who can edit the report can clear the workspace's cache from there.
- Rollup cache / Live query switch (report card → More actions, workspace or app admins): Live query makes every visual query the source directly.

## sharing — Public links and embedding
- Public link: report card → More actions → Share public link, then Copy public link. Anyone with the link can view it without signing in. Make private turns it off.
- Who may share publicly is set by an admin (Admin → Settings → Public report links: Model owners and admins, Admins only, or Nobody). Nobody also stops existing public links.
- Embed: report card → More actions → Embed… → optional Row-level security identity (an email) → Link expires after (1 hour, 24 hours, 30 days, 1 year) → Generate link → Copy the Embed URL or the Iframe snippet. Requires write access to the report's data model.
- Sharing with colleagues who sign in: put the report in a workspace and add them as members (see workspaces).

## export — Exporting a report
- Where: the Export (download) button in the editor toolbar or the viewer header.
- Export PDF (every page), Export PNG, Export Excel, Print.
- Editor only: Export raw (JSON) — a .openreport.json file you can re-import into another account or instance. The same file comes from a report card: More actions (⋮) → Export report.
- A data model can be exported as YAML from its card (Export as YAML).

## import — Importing reports, models and Power BI files
- Report: Reports stage → Import → Open Report → choose a .openreport.json file → Bind to data model (its fields must match) → Import.
- Model: Data Models stage → Import model → choose a .model.yaml file.
- Power BI: Reports stage → Import → Power BI (the report lands in the open workspace; the Import menu also lists Looker Studio, not available yet) → drop a .pbit file (Power BI Desktop → Save as → Template) → use an existing connection or create one → Next → review Tables, Joins, Measures translated, Measures kept as drafts, Pages, Visuals → set Model name and Report title → Import → Open the model / Open the report.
- A .pbit holds no data and no password. Not every DAX measure or visual can be converted; unconverted measures are kept as drafts and the review lists what was not supported.
- Custom Power BI visuals (third-party or private, e.g. a sankey or a flow tree) are never imported: the review shows an alert naming each one and how many times it is used, and a placeholder keeps its place on the page. Rebuild them with a built-in visual (Custom visuals → built-in · install) or one from the workspace library.
- Who: admins and editors.

## viewer — Viewing a report (and on mobile)
- Open it from a report card → View, or from a shared link. Pages are listed in the navigation column.
- Header buttons: Refresh all widgets, Bookmarks, Export, Fullscreen.
- Bookmarks save the current page and filters under a name (Save current view as…) and recall them later. They are personal.
- Slicers, report filters, cross-filtering and drill-down work in the viewer.
- On a phone the report stacks its widgets in one column, or scales the page, depending on Report settings → Small Screens. Building reports on a phone is possible but limited: the editor's panels open as a sheet with Settings, Data and Assistant tabs, and + opens the widget palette.

## api-tokens — API tokens
- For scripts: a token acts as you on /api/v1 only (list models and reports, rebuild a model's or report's cache).
- Available only if an admin enabled the API (Admin → API tokens → Enable the API) and your role is allowed (Who may hold a token: Admins only, Admins and editors, Everyone).
1. User menu (your name, top-right) → API tokens.
2. Enter a Token name, optional Expires in (days), tick scopes read and/or refresh → Create.
3. Copy the token now: it is shown only once. Revoke it from the same list.

## admin — The Admin page
- Admins only. Where: user menu (top-right) → Admin. Tabs: Users, Settings, Groups, Resources, Alerts, Usage, API tokens, AI.
- Users: Add User (Email, Password, Display name, role) → Create; change a role from the list; Reset password; delete.
- Settings: storage usage, Query timeout, Query cache (on/off, TTL, flush), Public report links.
- Groups: create groups and add members; use them in RLS as group:name.
- Resources: every data source, data model and report of the instance, with who created it, the workspace it lives in and the workspaces it is shared with. Switch between the three lists and search by name, creator or workspace. It lists them, it does not open their data. The trash icon at the end of a row deletes it, for everyone. Delete in order: a data source used by data models, or a data model used by reports, cannot be deleted until those are gone (the icon is greyed out and its tooltip says how many are left).
- Alerts: every alert on the instance. Usage: most viewed reports, slowest queries, per-model stats, report freshness, recent cache builds.
- API tokens: turn the API on/off, choose who may hold a token, revoke tokens.
- AI: set up the AI assistant (see ai-access).

## ai-access — Who has the AI assistant, and your own AI provider
- An admin turns it on in Admin → AI → Enable the assistant, then optionally sets an instance Provider (Anthropic or any OpenAI-compatible server), Base URL, Model and API key → Save & test.
- What the assistant may send to the provider: Schema only, or Schema and cached data. It never reads the live data source.
- Who has the assistant lists every account; an admin can switch a person to No assistant. Remove provider drops the instance provider.
- If the assistant is on but the instance has no provider, each user can plug in their own: the assistant panel shows Your AI provider (Provider, Base URL, Model, API key) → Save & test. Change it later with the Your AI provider (gear) button. Your key stays private; what is sent is still the admin's choice.
- Admin → AI also shows answers users rated (thumbs up/down).

## ai-editor — The AI assistant in the report editor
- Who: people who can edit the report, when the assistant is available to them and the report has a data model. Where: editor toolbar → AI assistant (sparkles).
- Two modes: Visuals (ask a business question; it proposes visuals) and Design (describe the look; it proposes layout, colour or theme changes).
- It never changes the report by itself: each proposal is a card with Add visual / Add N visuals, or Apply N changes, and Dismiss. An applied proposal is one undo step (Ctrl+Z); a theme change has its own Revert button.
- In a workspace report it can also write a new custom visual, previewed sandboxed on sample data (Review the code); only a workspace admin can Add to library & insert.
- New conversation starts over; Stop cancels an answer.
- It does not change the data model (joins, dimension / measure flags, model measures, fact / dimension tables). The model assistant of the model editor does: the assistant offers an Open model assistant card to the model's owner or an admin.

## ask — The Assistant panel (ask your data)
- Who: admins and editors, when the assistant is available to them. Where: the Assistant bar docked on the right edge of the Data Sources / Data Models / Reports screens (click it to open or close the panel; on a phone, the sparkles button in the top header).
1. Pick the Data model at the top of the Assistant panel.
2. Type a question (Ask anything about your data…) → Send.
3. The answer shows a visual, switchable between Chart and Table. Rate it with Good answer / Bad answer.
4. Add to report → Existing report (choose Report and Page) or New report (Title, Workspace) → Add. Then Open in editor.
- It proposes visuals on any data model. To quote figures in its answer it reads only data already in the rollup cache, never the live database.
- It also answers questions about how to use OpenReport, and can do some things for you once you confirm (scheduling a report's cache refresh).
- If the target report is open in an editor, save and close it first, or its next save overwrites the addition.
- It does not change the data model (joins, dimension / measure flags, model measures, fact / dimension tables). The model assistant of the model editor does: the assistant offers an Open model assistant card to the model's owner or an admin.

## account — Your account menu
- Click your name (top-right): Theme (System, Light, Dark), API tokens (when allowed), Report a bug, Logout.
- Report a bug is also in the model editor header and in Report settings.
