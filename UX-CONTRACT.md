# UX contract

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Native select | `src/App.jsx` | Lead status and watch interval | Keyboard and open popup check |
| Form | Native fields with app validation | `src/App.jsx`, `src/ContentStudio.jsx` | Project, evidence, content brief | Empty and invalid input check |
| Toast | App toast | `src/App.jsx` | Brief success message | Browser workflow check |
| CRUD | Local workspace state | `src/App.jsx` | Ideas, evidence, leads, drafts | Browser workflow and reload check |
