# Ask a native speaker

Each row is a word or phrase that one of the two reviews doubted. It is not practised until a native speaker has looked at it.

For each row, add one line to native-confirmations.tsv: the id, a tab, then `confirmed`, or `corrected`, a tab and the corrected Slovenian. Answers given in a chat are entered the same way. Once `node tools/native-confirm.js` has applied a line, its row leaves this list.

## Unit 01

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u01-l04-i02 | Kako ti je ime? | What is your name? (informal: to a child or a peer) | review2 doubtful: The Slovenian and the examples are correct. The doubt is in the en field: '(to someone close)' is an odd note for asking a name, since you already know the name of someone close. The lesson's own s01 and p02 frame it as 'to a child'. The note would be clearer as '(informal: to a child or a peer)'. |  |

## Unit 02

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u02-l04-i01 | Onadva sta brata. | The two of them are brothers. | review2 doubtful: accept: 'Sta brata.' opens with the clitic sta and reads as the question Sta brata?; the natural short statement is Brata sta. examples: 'Kdo je to? Onadva sta brata.' answers a singular question about two people; To sta brata. would be the natural answer. Fix: accept: Brata sta.; example: Kdo je to? To sta brata. | accept: Brata sta.; example: Kdo je to? To sta brata. |

## Unit 03

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u03-l02-i08 | riba | fish | review2 doubtful: examples: Riba ali meso? glossed Fish or meat? As an offer (the sense this unit trains with Kavo ali čaj?) a native says Ribo ali meso?; the nominative only fits the reading Is it fish or meat? Other fields correct. |  |

## Unit 04

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u04-l05-i06 | Lep vikend. | Have a nice weekend. | review1 doubtful: The Slovenian, examples and helper are correct. But register is tagged neutral, while SSKJ marks vikend in the weekend sense pog. and Pravopis marks it knj. pog. That is the course's colloquial, as this unit itself tags kilo (knj. pog.) colloquial. Lep konec tedna. is the neutral form, so the register should probably be colloquial. |  |

## Unit 07

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u07-l02-i05 | Ne morete zgrešiti. | You can't miss it. (polite, or to several people) | review1 doubtful: Fields sl, examples, helper. Zgrešiti for missing a place is transitive in SSKJ, whose closest examples keep the object: ne boste je zgrešili, tega človeka ne moreš zgrešiti. The object-free headword may read as a calque or as 'you can't go wrong', and the example 'Cerkev je na trgu, ne morete zgrešiti' would more naturally have je. The helper says it is built like the English, but the English has 'it'. The listed variants Ne morete ga zgrešiti and Ne morete je zgrešiti are fine. A native should say whether the bare form is heard.; review2 doubtful: sl: SSKJ gives this sense of zgrešiti only with an object (ne boste je zgrešili, tega človeka ne moreš zgrešiti). Without one it may be heard in speech, but a native should confirm it as the headword, since the accept variants with ga and je are the attested pattern. helper: Built like English you can't miss it is not quite so, as the headword has no it. Fix: Ne morete ga zgrešiti. | Ne morete ga zgrešiti. |
| u07-l03-i02 | Kateri avtobus gre v center? | Which bus goes to the centre? | review2 doubtful: register: tagged neutral, but SSKJ labels iti for a vehicle's route as colloquial (pog. ta vlak gre na Jesenice, standard bo peljal). The sentence itself is natural in speech. The course tags karta colloquial on the same kind of evidence, so neutral needs a native's confirmation. |  |
| u07-l04-i03 | Kdaj gre naslednji vlak? | When does the next train leave? | review2 doubtful: register and helper: tagged neutral, and the helper presents gre as the verb for trains leaving, but SSKJ labels this use colloquial (pog. kdaj gre vlak, standard odpelje). The chunk is natural in speech and the accept variants are correct, but the tag and helper need a native's confirmation. |  |
| u07-l05-i02 | Je to prava smer? | Is this the right way? | review1 doubtful: Headword, gender of smer and variants are fine, but the second example 'Do postaje, je to prava smer?' is a fronted fragment that may sound built. Je to prava smer do postaje? looks more natural. A native should check that example.; review2 doubtful: examples: Do postaje, je to prava smer? is a stilted left-dislocation, and a speaker would more likely say Je to prava smer do postaje? The headword, the other example and the variants are fine. Fix: Je to prava smer do postaje? | Je to prava smer do postaje? |

## Unit 08

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u08-l03-i03 | Dežuje. | It's raining. | review2 doubtful: Dežuje is fine, but the accept variant Dež gre is labelled pog. in SSKJ and neknj. pog. in Pravopis, so it is below the written standard on an item tagged neutral. It is widely heard, so a native speaker should confirm whether it stays as an accepted answer. |  |
| u08-l03-i06 | dež | rain | review1 doubtful: Field examples and register: the example Danes gre dež uses dež gre, labelled pog. in SSKJ and neknj. pog. in Pravopis, while the item is tagged neutral. The style guide makes a neutral tag despite a label on the use in the item doubtful. The sentence itself is common speech, so a native speaker should decide the tag or the example.; review2 doubtful: Headword and gender are right, but the example Danes gre dež uses the construction SSKJ labels pog. and Pravopis neknj. pog., on an item tagged neutral. A native speaker should confirm the tag or the example. |  |

## Unit 09

| id | sl | en | doubt | proposed fix |
|---|---|---|---|---|
| u09-l01-i04 | Boli me grlo. | I have a sore throat. | review1 doubtful: Slovenian, English, accept and examples are fine. The doubt is the helper. grlo comes from Proto-Slavic *gъrdlo, PIE *gʷerh₃-, and the lookup names Latin gurges among its cognates, so German Gurgel can only be a distant link through Latin, which the Gurgel page does not confirm. English gargle is traced by Wiktionary to French gargouiller and is not shown as related, so offering it as a comparison looks like forced resemblance. Keep Gurgel only if a native or etymology source confirms it, otherwise set helper to null.; review2 doubtful: Slovenian, gloss, examples and accept are fine. The doubt is the helper: Gurgel is a real but remote relative (PIE *gwerh3- through Latin gurgulio), while the lookup traces gargle only to Old French gargouille and shows no link to grlo, so that half may be forced resemblance. Fix: grlo, throat: distantly related to German Gurgel. | grlo, throat: distantly related to German Gurgel. |
| u09-l01-i07 | noga | leg, foot | review1 doubtful: Headword, gender and form pl noge are right, and the first example is natural. The doubt is the second example, Moja noga je v redu: Slovenian normally leaves out the possessive with one's own body part, so moja reads as a calque of my leg and as a sentence built to show the word. Noga je v redu would be the natural form. Fix: Noga je v redu.; review2 doubtful: Headword, gender and pl form are correct. The doubt is the second example: 'Moja noga je v redu.' sounds translated, since Slovenian normally drops the possessive with a body part unless there is a contrast. Fix: Noga je v redu. | Noga je v redu.; Noga je v redu. |
| u09-l04-i05 | Pokličite rešilca. | Call an ambulance. (polite, or to several people) | review1 doubtful: Register. SSKJ labels rešilec pog. in the sense of ambulance, and the style guide makes an item tagged neutral despite such a label doubtful until a native confirms the tag. The form itself is right: Pravopis marks the noun živ., and SSKJ gives poklicali so rešilca, so the accusative rešilca stands. Examples and helper are fine.; review2 doubtful: The form is right: Pravopis marks rešilec živ., and SSKJ gives 'poklicali so rešilca'. The doubt is register: SSKJ labels the ambulance sense pog., and the item is tagged neutral, which the style guide holds as doubtful until a native confirms the tag. |  |
| u09-l04-i08 | pomoč | help | review2 doubtful: Noun, gender and examples are fine. The doubt is the helper's 'From pomagati': Wiktionary derives pomoč from the verb *pomoťi, so pomoč and pomagati look like relatives rather than one coming from the other. Fix: Related to pomagati, to help: Lahko pomagam? | Related to pomagati, to help: Lahko pomagam? |
