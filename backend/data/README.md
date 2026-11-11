# Bestiary data

`bestiary.json` lists every creature in Tibia's bestiary that can spawn as an Echo Warden, with its
bestiary class and difficulty.
It is the source for the monster dictionary: `MonsterFixtures` loads it into an empty database and
`bin/console app:bestiary:sync` brings an existing database up to date (adds new creatures, fixes
classes, removes entries that left the bestiary unless someone already used them).

Source: [TibiaWiki](https://tibia.fandom.com/wiki/Category:Bestiary_Creatures) (CC BY-SA),
fields `name`, `bestiaryclass` and `bestiarylevel` of each creature's infobox; bosses excluded.

Creatures that cannot be an Echo Warden (event, quest and arena creatures such as Kollos, Yeti or
Midnight Panther) are left out, following the "Ward" column of
[tibiopedia.pl/monsters/mine](https://tibiopedia.pl/monsters/mine).

Giant Rat, Greedcarrier Rat and the three Omega creatures (update 15.40) had no bestiary class or
level on TibiaWiki yet when they were added; their class and difficulty come from tibiopedia.pl
(difficulty from its charm points). Re-check them against TibiaWiki once their infoboxes are filled in.
