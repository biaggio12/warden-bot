# Bestiary data

`bestiary.json` lists every creature in Tibia's bestiary with its bestiary class and difficulty.
It is the source for the monster dictionary: `MonsterFixtures` loads it into an empty database and
`bin/console app:bestiary:sync` brings an existing database up to date (adds new creatures, fixes
classes, removes entries that left the bestiary unless someone already used them).

Source: [TibiaWiki](https://tibia.fandom.com/wiki/Category:Bestiary_Creatures) (CC BY-SA),
fields `name`, `bestiaryclass` and `bestiarylevel` of each creature's infobox; bosses excluded.
