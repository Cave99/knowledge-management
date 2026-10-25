---
id: markdown-files
title: Bringing your own knowledge
description: Add your team's existing Markdown files and let the library take care of the reading experience.
space: Tools & Resources
author: Marcus Taylor
updated_at: 2026-10-25T00:00:00Z
tags: [markdown, setup]
---

## A document is a file {#a-document-is-a-file}

Every document in this library lives in a `.md` file. You can read it in a text editor, keep it in Git, or update it using the tools you already have.

## Add a document {#add-a-document}

### Put the file in the knowledge folder {#put-the-file-in-the-knowledge-folder}

The application reads from `knowledge/` by default. Set the `CONTENT_DIR` environment variable to point at another folder of existing Markdown files.

### Describe it with frontmatter {#describe-it-with-frontmatter}

Add YAML at the beginning of the file to choose its title, description, space, and owner:

```yaml
---
id: daily-checklist
title: Daily checklist
description: The essentials for a smooth start.
space: Guides & Playbooks
author: Operations team
updated_at: 2026-10-25
---
```

All metadata is optional. Without it, KM flow uses the filename, folder, and file modification time.

## Give it some structure {#give-it-some-structure}

Use `##` headings for sections and `###` headings for steps. Those headings appear automatically in the document's contents sidebar.

Use ordinary Markdown for lists, tables, code, images, and links. Relative links between Markdown files open the matching document in the application.

## See your changes {#see-your-changes}

Save a file and the library refreshes automatically. This release is a reader: make changes using your normal text editor or AI tools.
