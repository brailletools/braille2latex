# Working in this repo

- When fixing a bug, find the root cause rather than patching the symptom — check whether the same assumption or logic is duplicated elsewhere (e.g. a CI workflow with its own hard-coded dependency list, a parallel implementation in another file/language) before considering a fix complete.

