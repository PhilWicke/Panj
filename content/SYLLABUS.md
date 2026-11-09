# Syllabus

The plan of the course, one section per level. Each unit is drafted from its section here, and `tests/content/units.test.js` holds the unit's lesson files to it: the lesson ids, roles and titles, the items in order, and the rule cards. `tools/syllabus.js` reads this file, so every planning line keeps its shape. Prose lines like this one are ignored.

How a unit is written down:

    ## <unit id> <Slovenian title> / <English title> (motif <motif>)
    ### <lesson id> <theme or consolidation>: <Slovenian title> / <English title>
    - Situations: <what the learner does in the lesson, in generic English>
    - Items (<count>): <item> | <item> | ...
    - Rules: <rule card ids, comma separated, or none>
    - Table keys: <the row and column keys of those cards' tables, or none>
    - Slot: <chunk with ___> with <filler>, <filler>
    - Dialogue (<lines> lines): <scene and setting in one sentence>
    Checkpoint: <one line per unit, after its lessons>

Items are written as the lesson's `sl` will be, chunks first, then single words, each met in a chunk or an example of the lesson before it is taught on its own. No item repeats across the course. An item that changes with the speaker's gender (`Rad berem.`, `Bil sem na morju.`) is planned in one form, and the other form goes into its `accept`. A Slot line is optional per lesson and present at least once per unit: the chunk is the lesson's item with a slot, each filler is an item of the same unit, and a production exercise swaps a filler in. A filler is written in the slot as the slot needs it, and that form goes into the filler item's `forms` (`Sem iz Nemčije.` records `Nemčije` under `gen` of `Nemčija`). Table keys outside `1`, `2`, `3`, `sg`, `du` and `pl` show as written until the app learns them. Settings stay generic: your hosts, a neighbour, an older relative, a passer-by.

# Level A1

A unit at A1 has five lessons, as `lessonCount` 5 in `units.json` says. Lessons 1 to 4 are theme lessons: 8 new items each, one or two rule cards, 4 to 8 structured exercises, 3 to 6 production exercises and one dialogue of 4 to 6 lines. Lesson 5 is the consolidation lesson: 6 new items, no rule card, 4 to 8 structured exercises, 3 to 6 production exercises and a dialogue of 6 to 8 lines that reuses the unit's chunks; its production and its dialogue `new_items` practise items of all four theme lessons. That is 38 items per unit and 380 for the level. Topics follow `reference/a1-topics.md`; where there is a choice of word, the more frequent one in `reference/gos-top3000.tsv` is planned.

The rule cards follow this grammar order across the units: biti with nisem, and ti and vi (u01); imeti with nimam, gender from endings, the dual, and numbers 1 to 4 with nouns (u02); the accusative with the animacy rule (u03); numbers to 100, 5 and more with the genitive, and the genitive after ni and with quantities (u04); iti (u05); the locative after v, na and pri (u06); the past with the l-participle, first with bil sem (u08, u10); the future with bom and one card on clitic order (u10).

## u01 Prvi stik / First contact (motif flower)

Focus: greetings and introductions, name, where from, please and thank you, ti and vi, ja and da, a and ali, živjo and čau next to dober dan, adijo next to nasvidenje, biti in the present with the first dual pronouns (midva sva).

### u01-l01 theme: Prvi pozdrav / First hello
- Situations: greeting your hosts at the door, saying please and thank you, good night and goodbye
- Items (8): Živjo. | Dober dan. | Dober večer. | Lahko noč. | Adijo. | Nasvidenje. | Hvala. | Prosim.
- Rules: r-biti-present, r-ti-vi
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (6 lines): your hosts welcome you at the door on an evening visit

### u01-l02 theme: Kako si? / How are you?
- Situations: greeting in the morning, asking how someone is, and answering yes or no
- Items (8): Dobro jutro. | Čau. | Kako si? | Kako ste? | Dobro, hvala. | A si v redu? | Ja. | Da.
- Rules: r-a-ali
- Table keys: none
- Dialogue (5 lines): your hosts greet you in the kitchen in the morning and ask how you are

### u01-l03 theme: Od kod ste? / Where are you from?
- Situations: saying where you are from, and that you are not from here
- Items (8): Od kod ste? | Od kod si? | Sem iz Nemčije. | Nisem od tukaj. | Ne. | Nemčija | Avstrija | Slovenija
- Rules: r-biti-negative
- Table keys: 1, 2, 3, sg, du, pl
- Slot: Sem iz ___. with Nemčija, Avstrija, Slovenija
- Dialogue (6 lines): a neighbour of your hosts asks where you are from

### u01-l04 theme: Me veseli / Nice to meet you
- Situations: asking and giving names, saying you are visiting, and asking someone to speak slowly
- Items (8): Kako vam je ime? | Kako ti je ime? | Me veseli. | Sem na obisku. | Oprostite. | Ne razumem. | Počasi, prosim. | Hvala lepa.
- Rules: r-ime-mi-je
- Table keys: none
- Dialogue (6 lines): an older person at your hosts' house greets you, speaks too fast and asks where you are from

### u01-l05 consolidation: Na obisku / On a visit
- Situations: a short visit from the first hello to the last goodbye, with the whole unit
- Items (6): Dobrodošli. | Kar naprej. | Hvala za vse. | Se vidimo. | Lep dan še naprej. | Srečno.
- Rules: none
- Table keys: none
- Dialogue (8 lines): a visit to your hosts' neighbours, from the greeting at the door to goodbye

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u02 Družina in ljudje / Family and people (motif heart)

Focus: family nouns with gender from endings, describing people, imeti with nimam, numbers 1 to 4 with the dual and plural of nouns, onadva sta.

### u02-l01 theme: Imam brata / I have a brother
- Situations: talking about brothers, sisters and children
- Items (8): Imam brata. | Imaš brate ali sestre? | Imate otroke? | Nimam otrok. | To je moja družina. | brat | sestra | otrok
- Rules: r-imeti-present, r-imeti-negative
- Table keys: 1, 2, 3, sg, du, pl
- Slot: Imam ___. with brat, sestra, otrok
- Dialogue (5 lines): an older relative of your hosts asks about your family

### u02-l02 theme: Kdo je to? / Who is this?
- Situations: naming the people in a family photo
- Items (8): Kdo je to? | To je moj oče. | To je moja mama. | Imata sina in hčerko. | oče | mama | sin | hčerka
- Rules: r-gender-endings
- Table keys: none
- Dialogue (5 lines): your hosts show you photos of their family

### u02-l03 theme: Kakšen je? / What is he like?
- Situations: describing people and asking someone's age
- Items (8): Kakšen je? | Zelo je prijazen. | Koliko si star? | Koliko ste stari? | Ona je še mlada. | star | mlad | prijazen
- Rules: r-adjective-agreement
- Table keys: m, f, n, sg, du, pl
- Dialogue (5 lines): your hosts describe a relative who is coming to visit

### u02-l04 theme: Dva otroka / Two children
- Situations: counting people from one to four, and two people at once
- Items (8): Onadva sta brata. | Imava dva otroka. | Imam dve sestri. | Imajo tri otroke. | ena | dva | tri | štiri
- Rules: r-numbers-1-4, r-dual-nouns
- Table keys: m, f, n, one, two, three, four, sg, du, pl
- Dialogue (5 lines): a neighbour asks about the children and the brothers and sisters in your family

### u02-l05 consolidation: Obisk pri sorodnikih / Visiting relatives
- Situations: a visit to your hosts' relatives: greetings, family, ages and goodbyes
- Items (6): Lepo te je videti. | Kako so vsi? | Vsi so zdravi. | Kje so otroci? | Pozdravi vse doma. | Pridite spet.
- Rules: none
- Table keys: none
- Dialogue (8 lines): a Sunday afternoon with your hosts' relatives, from hello to goodbye

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u03 Pri mizi / At the table (motif wheat)

Focus: food and drink chunks with the accusative (pijem kavo, jem kruh), offering, accepting and declining politely, lahko dobim, praising food, še, pa.

### u03-l01 theme: Kava ali čaj? / Coffee or tea?
- Situations: being offered a drink and asking for one
- Items (8): Kavo ali čaj? | Pijem kavo. | Lahko dobim vodo? | Z mlekom, prosim. | kava | čaj | voda | mleko
- Rules: r-accusative-feminine, r-lahko
- Table keys: none
- Slot: Lahko dobim ___? with voda, kava, mleko
- Dialogue (5 lines): your hosts offer you something to drink

### u03-l02 theme: Dober tek / Enjoy your meal
- Situations: sitting down to a meal, saying what you eat, and praising the food
- Items (8): Dober tek. | Kaj je za kosilo? | Jem kruh. | Zelo je dobro. | kruh | meso | krompir | riba
- Rules: r-accusative-masculine
- Table keys: none
- Dialogue (5 lines): lunch with your hosts, with meat, potatoes and bread

### u03-l03 theme: Še malo? / A little more?
- Situations: being offered more, accepting, and declining politely
- Items (8): Postrezite si. | Še malo? | Ja, prosim. | Ne, hvala. | Kaj pa ti? | Ne morem več. | Dovolj je. | Ni treba.
- Rules: r-particles-se-pa
- Table keys: none
- Dialogue (6 lines): your hosts keep offering more food

### u03-l04 theme: Za zajtrk / For breakfast
- Situations: the meals of the day, and what you eat or do not eat
- Items (8): Kaj ješ za zajtrk? | Ne jem mesa. | Kdaj je večerja? | Večerja je na mizi. | zajtrk | kosilo | večerja | hrana
- Rules: r-jesti-piti
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (6 lines): your hosts ask what you eat for breakfast and when dinner is

### u03-l05 consolidation: Kosilo pri gostiteljih / Lunch with your hosts
- Situations: a long lunch: sitting down, helping, eating, praising and thanking
- Items (6): Sedite, prosim. | Lahko pomagam? | Res je okusno. | Kje je sol? | Lahko dobim recept? | Hvala za kosilo.
- Rules: none
- Table keys: none
- Dialogue (8 lines): Sunday lunch with your hosts, from sitting down to thanking them

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u04 V kavarni in v trgovini / In the café and the shop (motif cup)

Focus: ordering, paying, numbers to 100, prices, koliko stane, the genitive after 5 and more and after ni.

### u04-l01 theme: V kavarni / In the café
- Situations: ordering at a café table and asking for the bill
- Items (8): Kaj boste? | Eno kavo, prosim. | Zame čaj. | Kozarec vode, prosim. | Račun, prosim. | sok | pivo | vino
- Rules: r-genitive-quantity
- Table keys: none
- Slot: Kozarec ___, prosim. with sok, pivo, vino
- Dialogue (5 lines): ordering drinks for two at a café table

### u04-l02 theme: Koliko stane? / How much is it?
- Situations: asking prices, understanding numbers up to 100, and paying
- Items (8): Koliko stane? | Koliko je skupaj? | To je predrago. | Plačam s kartico. | evro | pet | deset | sto
- Rules: r-numbers-to-100
- Table keys: none
- Dialogue (5 lines): paying for coffee and cake at the counter

### u04-l03 theme: V trgovini / In the shop
- Situations: buying fruit and eggs by the kilo or the piece
- Items (8): Kilo jabolk, prosim. | Deset jajc, prosim. | Še kaj? | To je vse. | Potrebujem vrečko. | jabolko | jajce | vrečka
- Rules: r-numbers-5-plus
- Table keys: none
- Dialogue (6 lines): buying apples and eggs at a small shop

### u04-l04 theme: Ni kruha / There is no bread
- Situations: asking for something that has run out, and taking something else
- Items (8): Imate svež kruh? | Ni več kruha. | Nimamo več. | Žal ne. | Vzamem to. | Kje je blagajna? | trgovina | denar
- Rules: r-genitive-ni
- Table keys: none
- Dialogue (6 lines): the bakery has run out of bread late in the day

### u04-l05 consolidation: Na tržnici / At the market
- Situations: a morning at the market and a café: ordering, prices, quantities and paying
- Items (6): Kaj želite? | Je to domače? | Malo več, prosim. | Imate drobiž? | Obdržite drobiž. | Lep vikend.
- Rules: none
- Table keys: none
- Dialogue (8 lines): Saturday morning at the market stalls, then coffee at a café

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u05 Dan in čas / Day and time (motif sun)

Focus: time of day, days, routine verbs, iti, grem na and grem v, making plans, ob with clock times.

### u05-l01 theme: Koliko je ura? / What time is it?
- Situations: asking and telling the time, and the parts of the day
- Items (8): Koliko je ura? | Ura je osem. | Ob kateri uri? | Ob osmih. | ura | zjutraj | popoldne | zvečer
- Rules: r-ob-time
- Table keys: none
- Dialogue (5 lines): your hosts tell you when breakfast is

### u05-l02 theme: Grem v trgovino / I am going to the shop
- Situations: saying where you are going, alone or together
- Items (8): Kam greš? | Kam greste? | Grem v trgovino. | Grem na kavo. | Grem domov. | Greva skupaj? | Gremo. | Pridem takoj.
- Rules: r-iti-present, r-grem-v-na
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (5 lines): you tell your hosts you are going to the shop and will be back soon

### u05-l03 theme: V soboto / On Saturday
- Situations: the days of the week, and when you have time
- Items (8): Kateri dan je danes? | Danes je ponedeljek. | V soboto imam čas. | Jutri ne morem. | ponedeljek | sobota | nedelja | jutri
- Rules: r-days
- Table keys: none
- Slot: V ___ imam čas. with sobota, nedelja, ponedeljek
- Dialogue (5 lines): planning a day out with your hosts for the weekend

### u05-l04 theme: Moj dan / My day
- Situations: an ordinary day: getting up, working, reading, going to bed
- Items (8): Vstanem ob sedmih. | Delam do petih. | Zvečer berem. | Grem spat. | Kaj delaš? | delati | brati | spati
- Rules: r-verb-present
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (6 lines): telling your hosts about an ordinary working day

### u05-l05 consolidation: Kdaj se dobimo? / When shall we meet?
- Situations: making a plan: the day, the time and where to go, and being a little late
- Items (6): Kdaj se dobimo? | Velja. | Malo zamujam. | Ni problema. | Se slišimo. | Do jutri.
- Rules: none
- Table keys: none
- Dialogue (8 lines): arranging coffee with a neighbour for the next day, then running late

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u06 Dom / Home (motif house)

Focus: rooms and things, the locative after v, na and pri, kje je, tukaj and tam.

### u06-l01 theme: Kje je kopalnica? / Where is the bathroom?
- Situations: finding your way around your hosts' house
- Items (8): Kje je kopalnica? | Tukaj je tvoja soba. | Kuhinja je tam. | Počutite se kot doma. | kopalnica | kuhinja | soba | stranišče
- Rules: r-kje-kam
- Table keys: none
- Slot: Kje je ___? with kuhinja, soba, stranišče
- Dialogue (5 lines): your hosts show you round the house when you arrive

### u06-l02 theme: V kuhinji / In the kitchen
- Situations: saying where things are in the kitchen
- Items (8): V kuhinji. | Ključ je na mizi. | Kozarci so v omari. | Mleko je v hladilniku. | miza | omara | hladilnik | ključ
- Rules: r-locative
- Table keys: m, f, n, nom, loc
- Dialogue (5 lines): helping your hosts lay the table and asking where things are

### u06-l03 theme: Na balkonu / On the balcony
- Situations: in or on: v and na, and the places that take na
- Items (8): Na balkonu je lepo. | Sem na vrtu. | Knjiga je na postelji. | Okno je odprto. | vrt | postelja | okno | stol
- Rules: r-v-or-na
- Table keys: none
- Dialogue (5 lines): your hosts look for you in the house and find you in the garden

### u06-l04 theme: Pri nas / At our place
- Situations: where you live, at someone's place, by the door
- Items (8): Kje stanuješ? | Stanujem v centru. | Pri nas ni dvigala. | Čevlje pusti pri vratih. | hiša | stanovanje | vrata | sosed
- Rules: r-pri
- Table keys: none
- Dialogue (5 lines): a neighbour asks where you live and you describe the flat

### u06-l05 consolidation: Novo stanovanje / A new flat
- Situations: being shown round a flat: the rooms, where things are and what it is like
- Items (6): Koliko sob ima? | Zelo je svetlo. | Tukaj je mirno. | Kje je pralni stroj? | Imate tudi vrt? | Lepo stanovanje imate.
- Rules: none
- Table keys: none
- Dialogue (8 lines): looking round a flat to rent with your hosts, room by room

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u07 Po mestu / Around town (motif bird)

Focus: directions, transport, tickets, kako pridem do, the imperatives of directions for recognition only, z vlakom and z avtobusom.

### u07-l01 theme: Kako pridem do postaje? / How do I get to the station?
- Situations: asking the way in town
- Items (8): Kako pridem do postaje? | Je daleč? | Ni daleč. | Naravnost in potem levo. | levo | desno | postaja | banka
- Rules: r-do-genitive
- Table keys: none
- Slot: Kako pridem do ___? with postaja, banka
- Dialogue (5 lines): asking a passer-by the way to the bus station

### u07-l02 theme: Pojdite naravnost / Go straight on
- Situations: understanding the directions people give, in the imperative
- Items (8): Pojdite naravnost. | Zavijte desno. | Pri cerkvi levo. | Je za vogalom. | Ne morete zgrešiti. | ulica | trg | cerkev
- Rules: r-imperative-recognition
- Table keys: none
- Dialogue (5 lines): a passer-by explains the way to the old town

### u07-l03 theme: Z avtobusom / By bus
- Situations: how you get about, which bus, and where to get off
- Items (8): Grem z avtobusom. | Kateri avtobus gre v center? | Kje izstopim? | Peš je deset minut. | avtobus | vlak | avto | center
- Rules: r-z-instrumental
- Table keys: none
- Dialogue (6 lines): taking the bus into town and asking the driver where to get off

### u07-l04 theme: Eno karto, prosim / One ticket, please
- Situations: buying a ticket and asking about the next train
- Items (8): Eno karto za Ljubljano, prosim. | Enosmerno ali povratno? | Kdaj gre naslednji vlak? | Vlak zamuja. | karta | peron | prvi | minuta
- Rules: r-ordinals
- Table keys: none
- Dialogue (6 lines): buying a train ticket at the station counter

### u07-l05 consolidation: Izlet v mesto / A trip into town
- Situations: a day in town: asking for help, the way, the bus, a ticket home
- Items (6): Mi lahko pomagate? | Je to prava smer? | Kako dolgo traja? | Kje je staro mesto? | Nazaj grem z vlakom. | Hvala za pomoč.
- Rules: none
- Table keys: none
- Dialogue (8 lines): a day trip into town, from asking the way to buying a ticket home

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u08 Prosti čas in vreme / Free time and the weather (motif leaf)

Focus: weekends, hobbies, the weather, rad and rada, všeč mi je, small talk, the past tense introduced with bil sem. Fajn is recognition only.

### u08-l01 theme: Rad berem / I like reading
- Situations: saying what you like doing and what you do not
- Items (8): Kaj rad delaš? | Rad berem. | Rada kuham. | Rad hodim v hribe. | Ne maram športa. | knjiga | hrib | šport
- Rules: r-rad
- Table keys: m, f, sg, du, pl
- Dialogue (5 lines): talking with your hosts about what you like doing at the weekend

### u08-l02 theme: Všeč mi je / I like it
- Situations: saying what you like: places, music and films
- Items (8): Všeč mi je. | Ali ti je všeč? | Ni mi všeč. | Ljubljana mi je všeč. | glasba | film | morje | mesto
- Rules: r-vsec-mi-je
- Table keys: none
- Slot: ___ mi je všeč. with glasba, morje, mesto
- Dialogue (5 lines): your hosts ask how you like Slovenia so far

### u08-l03 theme: Kakšno je vreme? / What is the weather like?
- Situations: the weather, and small talk about it
- Items (8): Kakšno je vreme? | Lepo vreme je. | Dežuje. | Zelo je vroče. | Mrzlo je. | dež | sonce | sneg
- Rules: r-weather
- Table keys: none
- Dialogue (5 lines): small talk about the weather with a neighbour on the stairs

### u08-l04 theme: Kje si bil? / Where were you?
- Situations: saying where you were and how it was
- Items (8): Kje si bil? | Bil sem na morju. | Bila sem v hribih. | Kako je bilo? | Bilo je lepo. | Nisem bil doma. | včeraj | vikend
- Rules: r-past-biti
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (6 lines): on Monday morning your hosts ask about your weekend

### u08-l05 consolidation: Prosti dan / A day off
- Situations: small talk about a free day: plans, likes, the weather and how it went
- Items (6): Kaj počneš ta vikend? | Greš z nami? | Z veseljem. | Mogoče drugič. | Imej se lepo. | Fajn.
- Rules: none
- Table keys: none
- Dialogue (8 lines): your hosts invite you on a Sunday walk and talk about the weather and last weekend

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u09 Telo in zdravje / Body and health (motif hand)

Focus: the body, feeling well or ill, boli me, the pharmacy, moram.

### u09-l01 theme: Boli me glava / I have a headache
- Situations: saying what hurts
- Items (8): Kaj te boli? | Boli me glava. | Bolijo me noge. | Boli me grlo. | glava | roka | noga | hrbet
- Rules: r-boli-me
- Table keys: none
- Slot: Boli me ___. with roka, noga, hrbet
- Dialogue (5 lines): your hosts ask why you look tired, and you have a headache

### u09-l02 theme: Slabo mi je / I feel sick
- Situations: saying how you feel, and that you feel better
- Items (8): Kako se počutiš? | Slabo se počutim. | Slabo mi je. | Bolje mi je. | Imam vročino. | Prehlajen sem. | Utrujen sem. | bolan
- Rules: r-reflexive-se, r-dative-pronouns
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (5 lines): a morning when you feel ill and your hosts ask how you are

### u09-l03 theme: V lekarni / At the pharmacy
- Situations: asking for something at the pharmacy, and how often to take it
- Items (8): Kje je lekarna? | Imate kaj proti glavobolu? | Kolikokrat na dan? | Trikrat na dan. | Po jedi. | lekarna | tableta | zdravilo
- Rules: r-krat
- Table keys: none
- Dialogue (6 lines): asking the pharmacist for something against a headache

### u09-l04 theme: Moram k zdravniku / I have to see a doctor
- Situations: what you must and must not do when you are ill, and calling for help
- Items (8): Moram k zdravniku. | Moram počivati. | Moraš piti več vode. | Danes ne smeš delati. | Pokličite rešilca. | zdravnik | bolnišnica | pomoč
- Rules: r-moram
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (6 lines): your hosts tell you to rest and to see a doctor

### u09-l05 consolidation: Pri zdravniku / At the doctor's
- Situations: a visit to the doctor: what hurts, since when, how you feel and what to do
- Items (6): Kaj vas boli? | Od kdaj? | Od včeraj. | Imate zdravstveno kartico? | Nič hudega. | Hitro ozdravi.
- Rules: none
- Table keys: none
- Dialogue (8 lines): a short visit to the doctor, from the waiting room to what to take

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.

## u10 Delo in študij / Work and study (motif bee)

Focus: work and study, the week told in the past tense, the future with bom, the clitic-order card.

### u10-l01 theme: Kaj si po poklicu? / What do you do?
- Situations: saying what you do for a living and where you work
- Items (8): Kaj si po poklicu? | Kje delaš? | Delam v pisarni. | Sem študent. | služba | pisarna | učitelj | profesor
- Rules: r-feminine-professions
- Table keys: none
- Slot: Sem ___. with učitelj, profesor
- Dialogue (5 lines): a guest at your hosts' table asks what you do

### u10-l02 theme: Prejšnji teden / Last week
- Situations: telling what you did last week
- Items (8): Kaj si delal? | Ves dan sem delal. | Šel sem v službo. | Nisem imel časa. | teden | sestanek | čas | prejšnji
- Rules: r-past-l-participle
- Table keys: m, f, n, sg, du, pl
- Dialogue (6 lines): a colleague asks about your week

### u10-l03 theme: Jutri bom doma / Tomorrow I will be at home
- Situations: plans for tomorrow, next week and the holidays
- Items (8): Kaj boš delal jutri? | Jutri bom doma. | Kdaj boš prišel? | Bomo videli. | Jutri imam izpit. | izpit | počitnice | naslednji
- Rules: r-future-bom
- Table keys: 1, 2, 3, sg, du, pl
- Dialogue (5 lines): talking with your hosts about tomorrow and the summer holidays

### u10-l04 theme: Učim se slovensko / I am learning Slovenian
- Situations: what you study, your language course, and how it is going
- Items (8): Kaj študiraš? | Učim se slovensko. | Govorim malo slovensko. | Hodim na tečaj. | Ni lahko. | jezik | fakulteta | slovenščina
- Rules: r-clitic-order
- Table keys: none
- Dialogue (5 lines): a student at the next café table asks how your Slovenian is going

### u10-l05 consolidation: Moj teden / My week
- Situations: telling a week: what you did, what you do and what you will do
- Items (6): Kako je bilo v službi? | Bilo je naporno. | Imam veliko dela. | Končno je petek. | Komaj čakam vikend. | Se vidimo v ponedeljek.
- Rules: none
- Table keys: none
- Dialogue (8 lines): on Friday evening you tell your hosts about your week and your plans

Checkpoint: up to 16 of the unit's accepted items and 2 to 4 from earlier units, pass mark 80 percent.
