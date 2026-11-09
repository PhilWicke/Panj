# Ask a native speaker

Each row is a word or phrase that one of the two reviews doubted. It is not practised until a native speaker has looked at it.

For each row, add one line to native-confirmations.tsv: the id, a tab, then `confirmed`, or `corrected`, a tab and the corrected Slovenian. Answers given in a chat are entered the same way. Once `node tools/native-confirm.js` has applied a line, its row leaves this list.
