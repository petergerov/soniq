// Beispiel-Songs (ideas.md, Idee 22): fest eingebaute Vorlagen im Vorlagen-Menü. Anders als die Würfel zeigen sie eine
// vollständige Beschreibung und Lyrics mit [Verse]/[Chorus]-Marken. Namen übersetzt (ex_<id>), Inhalt Englisch wie alle Prompts.
import type { PresetValues } from "../../../../shared/api.ts";

export interface ExampleSong {
  id: string;
  title: string;
  prompt: string;
  /** Instrumental: "" (die Lyrics-Auswahl steht dann auf Instrumental) */
  lyrics: string;
  values: Pick<PresetValues, "style" | "vocals" | "vocal_language" | "duration" | "bpm" | "keyscale" | "timesignature">;
}

/** Wert im Vorlagen-Menü; eigene Vorlagen können so nicht heißen (Doppelpunkt) */
export const EXAMPLE_PREFIX = "example:";

export const EXAMPLE_SONGS: readonly ExampleSong[] = [
  {
    id: "funk_rock",
    title: "Neon Grease",
    prompt: "a sweaty basement club at midnight, everybody moving, tight and playful",
    lyrics: `[intro]

[verse]
Pull the fader, kill the lights
Basement walls are shaking tonight
Got a bassline crawling up my spine
Every step falls right in line

[pre-chorus]
Hold it, hold it, wait for the drop

[chorus]
Neon grease on the dance floor
Can't sit still, gotta give you more
Turn it up till the windows break
Shake it loose for the rhythm's sake

[verse]
Horns come in like a city bus
Nobody here is making a fuss
Slap that string and let it ring
Feel the floor begin to swing

[chorus]
Neon grease on the dance floor
Can't sit still, gotta give you more
Turn it up till the windows break
Shake it loose for the rhythm's sake

[bridge]
Break it down, just the drums and me
Count it in, one two three

[chorus]
Neon grease on the dance floor
Can't sit still, gotta give you more

[outro]`,
    values: {
      style: "funk rock, slap bass, wah guitar, punchy drums, brass stabs, male vocals, energetic",
      vocals: "song", vocal_language: "en", duration: 150, bpm: 112, keyscale: "E minor", timesignature: "4",
    },
  },
  {
    id: "synthwave",
    title: "Afterglow Drive",
    prompt: "driving along an empty coastal highway at night, city lights fading in the mirror",
    lyrics: `[intro]

[verse]
Taillights bleeding into rain
Radio is playing our song again
Ocean on the left, the city behind
Nothing but the road on my mind

[pre-chorus]
And the night is wide open

[chorus]
Afterglow, afterglow
Take me where the long roads go
Hearts on fire, engines low
Chasing the afterglow

[verse]
Polaroids on the dashboard shake
Every mile a memory we make
Static whispers, neon skies
Starlight falling in your eyes

[chorus]
Afterglow, afterglow
Take me where the long roads go
Hearts on fire, engines low
Chasing the afterglow

[instrumental]

[outro]
Chasing the afterglow`,
    values: {
      style: "synthwave, retro 80s, analog synth bass, gated reverb drums, shimmering pads, female vocals, nostalgic",
      vocals: "song", vocal_language: "en", duration: 180, bpm: 100, keyscale: "A minor", timesignature: "4",
    },
  },
  {
    id: "folk_ballad",
    title: "Kitchen Light",
    prompt: "an old farmhouse kitchen in late autumn, a letter to someone far away",
    lyrics: `[intro]

[verse]
The kettle hums the way it used to
Your chair still faces the door
I left the kitchen light on for you
Like I did the year before

[chorus]
So come home when the fields are golden
Come home when the river runs slow
I'll keep the kitchen light burning
Till the last of the swallows go

[verse]
The apple trees are heavy with waiting
The dog still sleeps by the gate
I write your name on the fogged-up window
And tell myself it's not too late

[chorus]
So come home when the fields are golden
Come home when the river runs slow
I'll keep the kitchen light burning
Till the last of the swallows go

[bridge]
And if the road is long, I'll wait
If the road is long, I'll wait

[outro]
I'll keep the kitchen light on`,
    values: {
      style: "indie folk, acoustic ballad, fingerpicked guitar, soft piano, warm, intimate, male vocals",
      vocals: "song", vocal_language: "en", duration: 165, bpm: 76, keyscale: "G major", timesignature: "4",
    },
  },
  {
    id: "boom_bap",
    title: "Concrete Notebook",
    prompt: "a rapper on a rooftop at dusk, looking back on growing up in the neighborhood",
    lyrics: `[intro]

[verse]
Pen to the page and the page to the street
Every block that I walked put a drum in my feet
Corner store lights and a borrowed beat
Mama said slow down, but I never could sleep
Concrete notebook, every line is a scar
Wrote it on the bus, wrote it under the stars
Now the same old rooftop, the same old view
But I see it all different, yeah, I see it brand new

[chorus]
This is for the ones on the corner still
Grinding every day with a dream to fulfil
Hands up high where the city can see
Concrete notebook, that's the story of me

[verse]
Crates full of vinyl and a cracked MPC
Learned every sample by the age of thirteen
Friends took the long way, some took the fast
I just kept writing to outrun the past
Now the kids on the block know the words to the hook
Funny how a life fits inside of a book

[chorus]
This is for the ones on the corner still
Grinding every day with a dream to fulfil
Hands up high where the city can see
Concrete notebook, that's the story of me

[outro]`,
    values: {
      style: "boom bap hip hop, dusty vinyl samples, punchy kick and snare, jazzy piano loop, male rap vocals",
      vocals: "song", vocal_language: "en", duration: 150, bpm: 90, keyscale: "D minor", timesignature: "4",
    },
  },
  {
    id: "lofi",
    title: "Window Seat",
    prompt: "a rainy afternoon in a small café, studying by the window",
    lyrics: "",
    values: {
      style: "lo-fi hip hop, mellow rhodes, vinyl crackle, soft boom bap drums, warm bass, calm, instrumental",
      vocals: "instrumental", vocal_language: "en", duration: 120, bpm: 80, keyscale: "F major", timesignature: "4",
    },
  },
  {
    id: "cinematic",
    title: "Over the Ridge",
    prompt: "a lone rider reaches the top of a mountain ridge as the sun breaks through the clouds",
    lyrics: "",
    values: {
      style: "cinematic orchestral, epic strings, french horns, taiko drums, choir, building, triumphant, instrumental",
      vocals: "instrumental", vocal_language: "en", duration: 150, bpm: 0, keyscale: "D minor", timesignature: "4",
    },
  },
  {
    id: "chiptune",
    title: "Level Seven",
    prompt: "the final level of a retro platform game, racing against the clock",
    lyrics: "",
    values: {
      style: "chiptune, 8-bit, square wave lead, arpeggios, noise drums, fast, playful, instrumental",
      vocals: "instrumental", vocal_language: "en", duration: 90, bpm: 150, keyscale: "C major", timesignature: "4",
    },
  },
  {
    id: "deep_house",
    title: "Low Tide",
    prompt: "a beach bar at sunset, the crowd slowly starting to dance",
    lyrics: "",
    values: {
      style: "deep house, four on the floor, warm sub bass, soft chord stabs, airy pads, groovy, instrumental",
      vocals: "instrumental", vocal_language: "en", duration: 180, bpm: 122, keyscale: "A minor", timesignature: "4",
    },
  },
];
