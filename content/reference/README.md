# Reference lists

The lists the course content is checked against. Nothing here is a copy of a source document except the trimmed frequency list, which its licence allows.

## gos-top3000.tsv

The most frequent lemmas of spoken Slovenian in the GOS 1.0 corpus, from the first 3,000 rows of the source list, trimmed for teaching. Item authors take `freq_rank` from here (see `content/STYLE_GUIDE.md`).

- Dataset: Čibej, Jaka; Arhar Holdt, Špela; Dobrovoljc, Kaja; Krek, Simon (2020). *Frequency lists of words from the GOS 1.0 corpus 1.1*. Slovenian language resource repository CLARIN.SI. http://hdl.handle.net/11356/1364 (issued 2020-10-28; replaces http://hdl.handle.net/11356/1269).
- Download URL: https://www.clarin.si/repository/xmlui/bitstream/handle/11356/1364/GOS1.0-words.zip?sequence=1&isAllowed=y (4,717,218 bytes, SHA-256 `f371451bd663556dee0ff9e84b28a58b698c1239d2105fccc011655c72e01e4e`), fetched 2026-11-08.
- File used inside the archive: `GOS1.0-words-all/GOS1.0-words-all-lemmas-parts_of_speech-taxonomy-entire.tsv` (32,160 lemma rows, sorted by descending frequency).
- Licence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), as stated on the repository page and in the file header. This derived file is under the same licence; cite the dataset above when reusing it.
- Columns: `rank` (the row number in the source order, 1 to 3,000), `lemma` (source column "Lemma"), `pos` (source column "Part of speech", as given), `frequency` (source column "Total absolute frequency of lemma").

How the file was made:

1. The 16 header lines of the source were dropped, the CSV-style double quotes stripped, 3 of its 18 columns kept and its first 3,000 data rows taken, numbered 1 to 3,000 in source order:

   ```
   tr -d '\r' < GOS1.0-words-all-lemmas-parts_of_speech-taxonomy-entire.tsv \
    | awk -F'\t' 'BEGIN{OFS="\t"; print "rank","lemma","pos","frequency"}
      NR>16 && n<3000 {for(i=1;i<=4;i++) gsub(/^"|"$/,"",$i); n++; print n,$1,$3,$4}'
   ```

2. Two kinds of rows were then dropped, keeping the source rank of every row that stays, so the ranks have gaps. The result is 2,808 rows.
   - Residual rows (tag `N`), except `živjo`. They are hesitation sounds (eee, hmm), spelled letters and foreign words, plus a few colloquial or dialect forms; none of them is planned for the course, while `živjo` is taught from the first lesson.
   - Capitalised lemmas, except place and nationality names. The others are names of people and political parties, brands and media, and Roman numerals or letters: none of them is course vocabulary, and the course names no real people. Kept: Slovenija, Ljubljana, Maribor, Celje, Koper, Kranj, Bled, Izola, Bohinj, Pohorje, Triglav, Alpe, Trst, Dunaj, Zagreb, Evropa, Amerika, Afrika, Hrvaška, Italija, Avstrija, Nemčija, Francija, Rusija, Irska, Egipt, Slovenec, Hrvat, Italijan, Nemec, Američan.

Part-of-speech letters (the JOS tagset): S noun, G verb, P adjective, R adverb, Z pronoun, K numeral, D preposition, V conjunction, L particle, M interjection, O abbreviation, N residual. Counts in the trimmed list: S 1246, G 572, P 388, R 310, K 76, Z 58, L 45, D 42, V 41, M 27, O 2, N 1.

Caveats:

- GOS 1.0 is small, about 1.04 million tokens, and dates from 2013, so ranks beyond the first few hundred are noisy. No newer GOS frequency list was found when the list was fetched.
- Tagging is automatic, so 71 lemmas of the trimmed list appear under more than one tag, up to four (`ne` as L and V, `kaj` as Z and R, `jaz` as Z and S). Each lemma and tag pair is its own row; `freq_rank` takes the lowest rank.
- Rank 3,000 falls inside a tie: source ranks 2,933 to 3,036 all have frequency 22, and the cut follows the source order within the tie, which is alphabetical. Ranks 2,933 to 3,000 are therefore an arbitrary part of that tie.

## a1-topics.md

An English summary of the A1 topic areas, communicative functions, model utterances and exam task types of two documents by the Center za slovenščino kot drugi in tuji jezik (CSDTJ), with printed page numbers, followed by the topic areas each A1 unit draws on.

- *Slovenščina kot drugi in tuji jezik. Izobraževalni program za odrasle*, CSDTJ, Ljubljana, March 2020: https://centerslo.si/wp-content/uploads/2020/08/Slovenscina-kot-drugi-in-tuji-jezik_centerslo.pdf. The text was read from the identical ministry copy, https://www.gov.si/assets/ministrstva/MVI/Dokumenti/Odrasli/Programoteka/Slovenscina-kot-drugi-in-tuji-jezik.pdf, because the text layer of the first drops some letters; the page numbers match.
- *Preživetvena raven za slovenščino, za potrebe programa Opismenjevanje v slovenščini za odrasle govorce drugih jezikov*, CSDTJ, Ljubljana, May 2016: https://centerslo.si/knjige/ucbeniki-in-prirocniki/prirocniki-in-ucno-gradivo/prezivetvena-raven-za-slovenscino/. The site offers it as a flipbook only; its pages are single PDFs at https://centerslo.si/wp-content/uploads/pdf-light-viewer/8659-pdfs/page-00001.pdf to `page-00031.pdf` (flipbook page = printed page + 1).

Neither document states a licence, and the Centerslo site reads "© CSDTJ 2025. Vse pravice pridržane." (all rights reserved). Both are therefore treated as all rights reserved: the summary quotes only short model utterances and topic labels, with page references, and no source file is kept in this repository.
