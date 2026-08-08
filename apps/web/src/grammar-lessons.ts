/**
 * The Learn course: a structured walk through Japanese grammar from zero.
 *
 * Seventeen lessons in reading order, how a sentence is built, then every
 * particle one by one, then verbs, endings and describing words. Each
 * lesson is written to be read in a few minutes, every claim carries an
 * example, and a short test at the end checks it stuck.
 *
 * The register matches the rest of the grammar tab: kana only, romaji on
 * every example, plain words wherever a plain word exists. The one piece of
 * jargon the course does teach is "particle", because the learner will meet
 * it everywhere else, it is introduced once, in lesson 1, and defined.
 */

export interface LessonExample {
  jp: string;
  r: string;
  en: string;
}

export interface LessonSection {
  heading: string;
  body: string;
  examples?: LessonExample[];
  /** Show the live sentence recipes right under this section. */
  recipes?: boolean;
  /** A drawn figure under the body: an id the lesson view knows how to draw. */
  visual?: "sentence-blocks" | "sticker" | "five-stickers";
}

export interface QuizQuestion {
  q: string;
  /** A Japanese line the question is about, shown large. ＿ marks a gap. */
  jp?: string;
  choices: string[];
  answer: number;
  /** Why, shown after answering, right or wrong. */
  why: string;
}

export interface Lesson {
  title: string;
  tagline: string;
  sections: LessonSection[];
  quiz: QuizQuestion[];
}

export const LESSONS: Lesson[] = [
  // ---------------------------------------------------------------- 1
  {
    title: "How a Japanese sentence works",
    tagline: "The last word does the talking, and stickers do the rest.",
    sections: [
      {
        heading: "The last word does the talking",
        visual: "sentence-blocks",
        body:
          "A Japanese sentence ends with the important part: an action (のむ, drink), a feeling (あつい, " +
          "hot), or です (is). Everything before it sets the scene.\n\n" +
          "English goes \"who does what\". Japanese goes \"who, what, does\". You find out what happened " +
          "at the end.",
        examples: [
          { jp: "さくらが みずを のむ", r: "sakura ga mizu wo nomu", en: "Sakura drinks water. (literally: Sakura water drinks)" },
          { jp: "ねこが ねる", r: "neko ga neru", en: "The cat sleeps." },
        ],
      },
      {
        heading: "Particles are stickers",
        visual: "sticker",
        body:
          "A particle is a tiny word like が, を, に or は. It sticks to the back of the word before it, " +
          "like a sticker that says the word's job.\n\n" +
          "みず is water. みずを is water wearing a sticker that says \"the action lands on me\".\n\n" +
          "English shows jobs with word order. Japanese shows them with stickers. A sticker always belongs " +
          "to the word in front of it, so read みずを as one piece: water, plus its sticker.",
      },
      {
        heading: "Five stickers to know",
        visual: "five-stickers",
        body: "Each one gets its own chapter later. For now, just meet them. Tap any of them to hear it.",
      },
      {
        heading: "The first sentence pattern",
        recipes: true,
        body:
          "{x}は {y}です means \"{x} is {y}\".\n\n" +
          "The \"is\" lives in です, not in は. は only says \"as for {x}\". Add か to the end and it " +
          "becomes a question.",
        examples: [
          { jp: "わたしは トムです", r: "watashi wa tomu desu", en: "I am Tom." },
          { jp: "これは ねこですか", r: "kore wa neko desu ka", en: "Is this a cat?" },
        ],
      },
      {
        heading: "Order is free",
        body:
          "The sticker carries the job, so the words can trade places. さくらが みずを のむ and " +
          "みずを さくらが のむ both mean Sakura drinks water. が is still on Sakura, so she's still the one " +
          "drinking.\n\n" +
          "Only two things are fixed: the ending comes last, and a describing word comes right before what " +
          "it describes.",
        examples: [
          { jp: "さくらが みずを のむ", r: "sakura ga mizu wo nomu", en: "Sakura drinks water." },
          { jp: "みずを さくらが のむ", r: "mizu wo sakura ga nomu", en: "Same meaning. The stickers didn't move." },
        ],
      },
      {
        heading: "A whole sentence can be tiny",
        body:
          "Japanese drops anything that's obvious. のむ on its own is a complete, natural sentence: " +
          "someone, clear from the situation, drinks. No \"I\", \"him\" or \"it\" needed if it's clear from " +
          "context. Japanese drops words like this a lot.\n\n" +
          "It's also common when introducing yourself to say ピエトロです instead of わたしは ピエトロです " +
          "(\"as for me, I am Pietro\"). Everyone already knows you're talking about yourself: you are the " +
          "topic, so you don't need to state it again.",
        examples: [
          { jp: "のむ", r: "nomu", en: "(I'll) drink. A full sentence." },
          { jp: "あつい", r: "atsui", en: "(It's) hot. Also a full sentence." },
          { jp: "ピエトロです", r: "pietoro desu", en: "(I'm) Pietro. The topic goes unsaid." },
        ],
      },
    ],
    quiz: [
      {
        q: "Which block does the real talking in a Japanese sentence?",
        choices: ["The first one", "The one with は", "The last one", "The longest one"],
        answer: 2,
        why: "The ending (the action, the feeling, or です) always comes last, and it's the point of the sentence.",
      },
      {
        q: "What is a particle?",
        choices: [
          "A decoration",
          "A sticker on the back of a word, saying that word's job",
          "A way to make the sentence polite",
          "The word for “the”",
        ],
        answer: 1,
        why: "が, を, に and friends each stick to the word before them and announce its job.",
      },
      {
        q: "Which word does を belong to here?",
        jp: "さくらが みずを のむ",
        choices: ["さくら", "みず", "のむ", "None, it stands alone"],
        answer: 1,
        why: "A particle always sticks to the word in front of it: [みず を], “water, the thing being drunk”.",
      },
      {
        q: "Fill the slot: “I drink water.”",
        jp: "わたしは みず＿ のむ",
        choices: ["は", "が", "を", "に"],
        answer: 2,
        why: "The water is what the drinking lands on, and を is the lands-on sticker.",
      },
      {
        q: "What does this mean?",
        jp: "みずを さくらが のむ",
        choices: ["The water drinks Sakura", "Sakura drinks water", "Sakura is water", "Water and Sakura drink"],
        answer: 1,
        why: "が is still stuck to Sakura, so she's still the doer. Moving words doesn't move the jobs.",
      },
      {
        q: "How do you turn これは ねこです into a question?",
        choices: [
          "Swap the words around",
          "Add か on the end",
          "Say it louder",
          "Change です to だ",
        ],
        answer: 1,
        why: "か at the very end makes any sentence a question. Nothing gets rearranged.",
      },
      {
        q: "Is のむ on its own a real sentence?",
        choices: ["Yes, who's drinking is understood from context", "No, it needs a stated doer", "Only in writing", "Only as a question"],
        answer: 0,
        why: "Japanese drops whatever is obvious. Someone drinks; the situation says who.",
      },
    ],
  },
  // ---------------------------------------------------------------- 2
  {
    title: "だ and です: saying “is”",
    tagline: "A thing plus だ is a whole sentence. です is the same word in a suit.",
    sections: [
      {
        heading: "Thing + だ",
        body:
          "To say something IS something, Japanese puts the thing first and だ after it: ねこだ, “(it) is a " +
          "cat”. だ is the ending here, so it comes last, like every ending. There is no separate word for " +
          "“am / is / are” to memorise, だ covers them all.",
        examples: [
          { jp: "ねこだ", r: "neko da", en: "(It) is a cat." },
          { jp: "がくせいだ", r: "gakusei da", en: "(I) am a student." },
          { jp: "あしたは やすみだ", r: "ashita wa yasumi da", en: "Tomorrow is a day off." },
        ],
      },
      {
        heading: "です, the polite twin",
        body:
          "です does exactly what だ does, politely. With strangers, at a shop, to a teacher, です. With " +
          "friends, in your head, in casual writing, だ. Nothing else changes: ねこだ and ねこです both mean " +
          "“it's a cat”.",
        examples: [
          { jp: "ねこです", r: "neko desu", en: "(It) is a cat., polite" },
          { jp: "わたしは がくせいです", r: "watashi wa gakusei desu", en: "I am a student., polite" },
        ],
      },
      {
        heading: "だ only points one way",
        body:
          "A だ sentence names what the thing before it IS, it is not an equals sign. わたしは うなぎだ, said " +
          "at a restaurant, doesn't claim you are an eel; it means “as for me, (the order) is eel. I'll have " +
          "the eel.” Japanese leans on context this way constantly.",
        examples: [
          { jp: "わたしは うなぎだ", r: "watashi wa unagi da", en: "I'll have the eel. (as for me, it is eel)" },
        ],
      },
    ],
    quiz: [
      {
        q: "How do you say “(it) is a dog” plainly?",
        choices: ["いぬです", "いぬだ", "だいぬ", "いぬが"],
        answer: 1,
        why: "Thing + だ. です would also be right, but politely.",
      },
      {
        q: "When would you reach for です instead of だ?",
        choices: ["Talking to a close friend", "Talking to a stranger or teacher", "Only in questions", "Never, they differ in meaning"],
        answer: 1,
        why: "です is だ in polite dress; the meaning is identical.",
      },
      {
        q: "At a restaurant, what does わたしは うなぎだ mean?",
        jp: "わたしは うなぎだ",
        choices: ["I am an eel", "I'll have the eel", "The eel is mine", "I don't like eel"],
        answer: 1,
        why: "だ names what the order is, not what you are. Context does the rest.",
      },
      {
        q: "Where does だ sit in its sentence?",
        choices: ["Before the thing", "After the thing, at the end", "Anywhere", "After the particle は"],
        answer: 1,
        why: "だ is the ending, and endings come last.",
      },
      {
        q: "Which of these is a complete sentence?",
        choices: ["やすみだ", "だ やすみ", "やすみを", "は やすみ"],
        answer: 0,
        why: "やすみだ, “(it) is a day off.” A thing plus だ is already whole.",
      },
    ],
  },
  // ---------------------------------------------------------------- 3
  {
    title: "が: the one doing it",
    tagline: "Every sentence has a doer, and が points straight at it.",
    sections: [
      {
        heading: "が marks the doer",
        body:
          "が tags whoever, or whatever, the ending is about: the one walking, the thing that is red, the " +
          "person who exists in the room. Find the が and you've found the sentence's anchor.",
        examples: [
          { jp: "とりが とぶ", r: "tori ga tobu", en: "The bird flies." },
          { jp: "みずが つめたい", r: "mizu ga tsumetai", en: "The water is cold." },
          { jp: "さくらが がくせいだ", r: "sakura ga gakusei da", en: "Sakura is a student." },
        ],
      },
      {
        heading: "The doer doesn't have to “do” much",
        body:
          "“Doer” is loose on purpose: with つめたい (is cold) the water isn't doing anything, it just IS the " +
          "cold one. が works for all three kinds of ending, actions, describing words, and thing+だ.",
        examples: [
          { jp: "いぬが おおきい", r: "inu ga ookii", en: "The dog is big." },
          { jp: "ねこが いる", r: "neko ga iru", en: "There is a cat. (a cat exists)" },
        ],
      },
      {
        heading: "Even when you can't see it",
        body:
          "When nobody says who, the doer is still there. Japanese just left it out because it was obvious. " +
          "たべる by itself has an invisible “I が” inside it. Getting comfortable with that invisible が is " +
          "the single most useful habit in this course.",
        examples: [
          { jp: "たべる", r: "taberu", en: "(I) eat., the doer is unsaid" },
          { jp: "きれいだ", r: "kirei da", en: "(It) is pretty." },
        ],
      },
    ],
    quiz: [
      {
        q: "Who is doing the sleeping?",
        jp: "いぬが ねる",
        choices: ["The dog", "Someone unsaid", "The sleep", "Nobody"],
        answer: 0,
        why: "が sits on いぬ, so the dog is the one sleeping.",
      },
      {
        q: "Which particle fits the gap? “The bird flies.”",
        jp: "とり＿ とぶ",
        choices: ["を", "が", "に", "だ"],
        answer: 1,
        why: "The bird is the doer, and が marks the doer.",
      },
      {
        q: "In みずが つめたい, what is the water doing?",
        jp: "みずが つめたい",
        choices: ["Flowing", "Nothing, it just IS the cold one", "Drinking", "Being drunk"],
        answer: 1,
        why: "が also anchors describing words: the water is the one that is cold.",
      },
      {
        q: "Does たべる (alone) have a doer?",
        jp: "たべる",
        choices: ["No, no doer at all", "Yes, unsaid, filled in from context", "Only if you add です", "Only in the past"],
        answer: 1,
        why: "Someone eats; Japanese leaves the obvious one out.",
      },
      {
        q: "What does さくらが がくせいだ say?",
        jp: "さくらが がくせいだ",
        choices: ["Sakura is a student", "The student is Sakura's", "Sakura teaches students", "Students like Sakura"],
        answer: 0,
        why: "が points at Sakura; がくせいだ says what she is.",
      },
    ],
  },
  // ---------------------------------------------------------------- 4
  {
    title: "は: the topic",
    tagline: "“As for…”: は sets the stage; が points the finger.",
    sections: [
      {
        heading: "は says what we're talking about",
        body:
          "は (read “wa”, not “ha”) doesn't mark a doer. It raises a topic: “as for X, here comes something " +
          "about it.” わたしは こうちゃが すきだ is literally “as for me, tea is pleasing”. The topic is me, " +
          "but the が is on the tea.",
        examples: [
          { jp: "きょうは あつい", r: "kyou wa atsui", en: "As for today, (it's) hot." },
          { jp: "ねこは かわいい", r: "neko wa kawaii", en: "As for cats, (they're) cute." },
        ],
      },
      {
        heading: "は vs が",
        body:
          "が answers “who?”. は answers “what about it?”. さくらが きた answers " +
          "“who came?” (SAKURA came). さくらは きた answers “what did Sakura do?” (as for Sakura, she " +
          "came).\n\n" +
          "It's a bit like “a” vs “the” in English. わたしは がくせいだ introduces you: “I'm a student.” " +
          "わたしが がくせいだ singles you out: “I'm THE student, the one you're looking for.” This isn't a " +
          "strict rule, just a useful feel.",
        examples: [
          { jp: "さくらが きた", r: "sakura ga kita", en: "SAKURA came. (answering: who came?)" },
          { jp: "さくらは きた", r: "sakura wa kita", en: "As for Sakura, she came. (we were already talking about her)" },
          { jp: "わたしは がくせいだ", r: "watashi wa gakusei da", en: "I'm a student. (introducing)" },
          { jp: "わたしが がくせいだ", r: "watashi ga gakusei da", en: "I'm THE student. (the one in question)" },
        ],
      },
      {
        heading: "は and が in the same sentence",
        body:
          "One very common pattern uses both: Xは Yが Z, “as for X, its Y is Z”.\n\n" +
          "かれは めが おおきい is literally “as for him, the eyes are big”. English just says “his eyes are " +
          "big”. When you see は and が together, the は part is the headline and the が part is the detail.",
        examples: [
          { jp: "かれは めが おおきい", r: "kare wa me ga ookii", en: "His eyes are big. (as for him, the eyes are big)" },
          { jp: "ぞうは はなが ながい", r: "zou wa hana ga nagai", en: "Elephants have long noses. (as for elephants, the nose is long)" },
        ],
      },
      {
        heading: "は often hides a が",
        body:
          "When the topic and the doer are the same person, は takes the stage and the が goes invisible: " +
          "わたしは たべる is really “as for me, (I) eat.” That's why so many sentences have は where you'd " +
          "expect が, the が is still there, just unsaid.\n\n" +
          "When even the topic is obvious, it goes too. Introducing yourself, トムです is enough.\n\n" +
          "Nobody chooses は or が by a rule, natives included. The feel comes from seeing sentences. When " +
          "in doubt, use は and move on.",
        examples: [
          { jp: "わたしは たべる", r: "watashi wa taberu", en: "As for me, (I) eat." },
          { jp: "トムです", r: "tomu desu", en: "(I'm) Tom., the obvious topic just stays home" },
          { jp: "わたしは うなぎだ", r: "watashi wa unagi da", en: "As for me, (the order) is eel." },
        ],
      },
    ],
    quiz: [
      {
        q: "How is は pronounced when it works as a particle?",
        choices: ["ha", "wa", "e", "silent"],
        answer: 1,
        why: "The topic particle は is read “wa”, one of Japanese's few spelling quirks.",
      },
      {
        q: "What does は do?",
        choices: ["Marks the doer", "Sets the topic, “as for…”", "Marks the past", "Makes it a question"],
        answer: 1,
        why: "は frames what the sentence is about; the doer is が's job.",
      },
      {
        q: "Someone asks “WHO came?” Which answer fits?",
        choices: ["さくらは きた", "さくらが きた", "さくらに きた", "さくらを きた"],
        answer: 1,
        why: "Pointing out WHO is exactly what が does.",
      },
      {
        q: "What is the literal shape of わたしは たべる?",
        jp: "わたしは たべる",
        choices: ["Me-eating is good", "As for me, (I) eat", "I am food", "Eat me"],
        answer: 1,
        why: "は raises the topic “me”; the doer が is the same person, so it goes unsaid.",
      },
      {
        q: "きょうは あつい, what is きょう here?",
        jp: "きょうは あつい",
        choices: ["The one being hot, only", "The topic, “as for today”", "A place", "The action"],
        answer: 1,
        why: "は sets today as the stage, then the sentence says something about it.",
      },
      {
        q: "What does this mean?",
        jp: "かれは めが おおきい",
        choices: ["He is an eye", "His eyes are big", "The eye watches him", "Big things have eyes"],
        answer: 1,
        why: "Xは Yが Z: “as for him, the eyes are big.” は gives the headline, が gives the detail.",
      },
    ],
  },
  // ---------------------------------------------------------------- 5
  {
    title: "を: what the action lands on",
    tagline: "Eat WHAT? Read WHAT? を tags the answer.",
    sections: [
      {
        heading: "を marks the target of an action",
        body:
          "When an action lands on something, eat bread, read a book, drink water, を tags the thing it " +
          "lands on. It's written を but read “o”. The doer keeps が (or hides behind は); the thing acted on " +
          "takes を.",
        examples: [
          { jp: "ねこが さかなを たべる", r: "neko ga sakana wo taberu", en: "The cat eats a fish." },
          { jp: "わたしは ほんを よむ", r: "watashi wa hon wo yomu", en: "I read a book." },
          { jp: "みずを のむ", r: "mizu wo nomu", en: "(I) drink water." },
        ],
      },
      {
        heading: "が and を together tell the whole story",
        body:
          "Swap the two tags and the meaning flips completely, even with every word in place: ねこが さかなを " +
          "たべる, the cat eats the fish. さかなが ねこを たべる, the fish eats the cat. The tags decide, " +
          "not the order.",
        examples: [
          { jp: "ねこが さかなを たべる", r: "neko ga sakana wo taberu", en: "The cat eats the fish." },
          { jp: "さかなが ねこを たべる", r: "sakana ga neko wo taberu", en: "The fish eats the cat." },
        ],
      },
      {
        heading: "Not every English object takes を",
        body:
          "Where English says “meet someone” or “ride a train,” Japanese sometimes reaches for a different " +
          "tag: ともだちに あう (meet TO a friend), でんしゃに のる (ride ON a train). When you learn a new " +
          "action word, notice which tag it likes, the pair travels together.",
        examples: [
          { jp: "ともだちに あう", r: "tomodachi ni au", en: "(I) meet a friend., に, not を" },
          { jp: "でんしゃに のる", r: "densha ni noru", en: "(I) get on the train., に, not を" },
        ],
      },
    ],
    quiz: [
      {
        q: "Which particle fits? “Sakura reads a book.”",
        jp: "さくらが ほん＿ よむ",
        choices: ["が", "は", "を", "に"],
        answer: 2,
        why: "The book is what the reading lands on, and を tags that.",
      },
      {
        q: "What does さかなが ねこを たべる mean?",
        jp: "さかなが ねこを たべる",
        choices: ["The cat eats the fish", "The fish eats the cat", "The cat and fish eat", "Someone eats cat and fish"],
        answer: 1,
        why: "が is on the fish, it's the doer. The cat wears を, so it's dinner.",
      },
      {
        q: "How is the particle を pronounced?",
        choices: ["wo, strongly", "o", "u", "silent"],
        answer: 1,
        why: "It's written を but read as a plain “o”.",
      },
      {
        q: "Which word is the doer here?",
        jp: "こどもが えを かく",
        choices: ["こども", "え", "かく", "There isn't one"],
        answer: 0,
        why: "が sits on こども (the child); え wears を and is what gets drawn.",
      },
      {
        q: "“(I) meet a friend”, which is right?",
        choices: ["ともだちを あう", "ともだちに あう", "ともだちは あう", "ともだちで あう"],
        answer: 1,
        why: "あう likes に: you meet TO someone in Japanese. Some actions choose their own tag.",
      },
    ],
  },
  // ---------------------------------------------------------------- 6
  {
    title: "に and へ: where it's headed",
    tagline: "に pins an exact point, place, time, or person. へ just points the way.",
    sections: [
      {
        heading: "に: the pin",
        body:
          "に drops a pin: where something ends up (がっこうに いく, go to school), where it sits (へやに いる " +
          ",  be in the room), or who it's aimed at (ともだちに あげる, give to a friend).",
        examples: [
          { jp: "さくらが がっこうに いく", r: "sakura ga gakkou ni iku", en: "Sakura goes to school." },
          { jp: "ねこが へやに いる", r: "neko ga heya ni iru", en: "The cat is in the room." },
          { jp: "ともだちに てがみを かく", r: "tomodachi ni tegami wo kaku", en: "(I) write a letter to a friend." },
        ],
      },
      {
        heading: "に also pins times",
        body:
          "Clock times and dates take に, just where English says at, on or in: 9じに (at nine), にちようびに " +
          "(on Sunday). Loose words like today, tomorrow and every day stand alone, no に needed.",
        examples: [
          { jp: "9じに おきる", r: "ku-ji ni okiru", en: "(I) get up at nine." },
          { jp: "きょう がっこうに いく", r: "kyou gakkou ni iku", en: "Today (I) go to school., きょう takes no に" },
        ],
      },
      {
        heading: "へ: the direction",
        body:
          "へ (read “e”) points a direction rather than pinning a spot, “towards.” In everyday speech に and " +
          "へ overlap for destinations; へ feels a little more like a compass needle, に like an X on the map.",
        examples: [
          { jp: "うちへ かえる", r: "uchi e kaeru", en: "(I) head home." },
          { jp: "とりが そらへ とぶ", r: "tori ga sora e tobu", en: "The bird flies toward the sky." },
        ],
      },
    ],
    quiz: [
      {
        q: "Which particle fits? “The cat is in the room.”",
        jp: "ねこが へや＿ いる",
        choices: ["を", "に", "が", "へ"],
        answer: 1,
        why: "Where something sits is a pin, and に is the pin.",
      },
      {
        q: "How is the particle へ pronounced?",
        choices: ["he", "e", "we", "silent"],
        answer: 1,
        why: "Like は→wa, the particle へ reads “e”.",
      },
      {
        q: "“(I) get up at seven.” Which is right?",
        choices: ["7じを おきる", "7じに おきる", "7じは おきる", "7じで おきる"],
        answer: 1,
        why: "Clock times take に, the same pin as places.",
      },
      {
        q: "What does ともだちに てがみを かく mean?",
        jp: "ともだちに てがみを かく",
        choices: [
          "A friend writes me a letter",
          "(I) write a letter to a friend",
          "(I) write about a friend",
          "The friend and I write letters",
        ],
        answer: 1,
        why: "に marks who it's aimed at, を marks what gets written.",
      },
      {
        q: "うちへ かえる, what does へ add?",
        jp: "うちへ かえる",
        choices: ["An exact arrival point", "A direction, “towards home”", "A time", "Politeness"],
        answer: 1,
        why: "へ points the way; に would pin the destination. For going home, both are heard.",
      },
    ],
  },
  // ---------------------------------------------------------------- 7
  {
    title: "で: where it happens, and how",
    tagline: "The stage the action plays on, or the tool it's done with.",
    sections: [
      {
        heading: "で: the stage",
        body:
          "で marks where an action HAPPENS, the stage it plays out on. Compare に: へやに いる (the cat IS in " +
          "the room, a pin) but へやで あそぶ (plays IN the room, the room is the stage the playing happens " +
          "on). If something is being done, the place it's being done takes で.",
        examples: [
          { jp: "こどもが こうえんで あそぶ", r: "kodomo ga kouen de asobu", en: "The child plays in the park." },
          { jp: "としょかんで べんきょうする", r: "toshokan de benkyou suru", en: "(I) study at the library." },
        ],
      },
      {
        heading: "で: the tool",
        body:
          "The same で marks what an action is done WITH, the tool, the method, the vehicle: はしで たべる " +
          "(eat with chopsticks), でんしゃで いく (go by train), にほんごで はなす (speak in Japanese).",
        examples: [
          { jp: "はしで たべる", r: "hashi de taberu", en: "(I) eat with chopsticks." },
          { jp: "でんしゃで いく", r: "densha de iku", en: "(I) go by train." },
        ],
      },
      {
        heading: "に or で? Ask what the place is doing",
        body:
          "If the place is just where something IS or ENDS UP, に. If the place is where something is " +
          "HAPPENING, で. がっこうに いく (school is the destination) but がっこうで べんきょうする (school is " +
          "where the studying happens).",
        examples: [
          { jp: "がっこうに いく", r: "gakkou ni iku", en: "(I) go to school., destination" },
          { jp: "がっこうで べんきょうする", r: "gakkou de benkyou suru", en: "(I) study at school., stage" },
        ],
      },
    ],
    quiz: [
      {
        q: "Which particle fits? “The child plays in the park.”",
        jp: "こどもが こうえん＿ あそぶ",
        choices: ["に", "で", "を", "へ"],
        answer: 1,
        why: "The park is the stage the playing happens on, で.",
      },
      {
        q: "“(I) eat with chopsticks.” Which is right?",
        choices: ["はしに たべる", "はしを たべる", "はしで たべる", "はしは たべる"],
        answer: 2,
        why: "で marks the tool. はしを たべる would mean eating the chopsticks.",
      },
      {
        q: "Why is it へやに いる but へやで あそぶ?",
        choices: [
          "いる is polite",
          "Being somewhere takes に; doing something somewhere takes で",
          "They're interchangeable",
          "あそぶ is irregular",
        ],
        answer: 1,
        why: "に pins where something is; で stages where something happens.",
      },
      {
        q: "What does でんしゃで いく mean?",
        jp: "でんしゃで いく",
        choices: ["(I) go to the train", "(I) go by train", "The train leaves", "(I) like trains"],
        answer: 1,
        why: "で marks the means, the train is how the going gets done.",
      },
      {
        q: "Which sentence says the studying happens at school?",
        choices: ["がっこうに べんきょうする", "がっこうで べんきょうする", "がっこうを べんきょうする", "がっこうへ べんきょうする"],
        answer: 1,
        why: "The action's stage takes で.",
      },
    ],
  },
  // ---------------------------------------------------------------- 8
  {
    title: "と・や・も: and, with, too",
    tagline: "Listing things, doing things together, and saying “me too”.",
    sections: [
      {
        heading: "と: a complete “and”, or “together with”",
        body:
          "Between things, と lists them ALL: ねこと いぬ, the cat and the dog, that's the whole list. After a " +
          "person, it also means doing something together: さくらと はなす, talk with Sakura.",
        examples: [
          { jp: "ねこと いぬが いる", r: "neko to inu ga iru", en: "There's a cat and a dog." },
          { jp: "さくらと はなす", r: "sakura to hanasu", en: "(I) talk with Sakura." },
        ],
      },
      {
        heading: "や: an open “and”",
        body:
          "や also joins things, but leaves the list open, “things like…”: パンや たまごを かう means (I) buy " +
          "bread and eggs, among other things. と closes the list; や leaves the door ajar.",
        examples: [
          { jp: "パンや たまごを かう", r: "pan ya tamago wo kau", en: "(I) buy bread, eggs and such." },
        ],
      },
      {
        heading: "も: too",
        body:
          "も REPLACES が, は or を and means “too / also”: わたしも いく. I'm going too. Doubled up it means " +
          "“both… and…”: ねこも いぬも すきだ. I like both cats and dogs. Note that も pushes the other " +
          "particle out; you never say がも.",
        examples: [
          { jp: "わたしも いく", r: "watashi mo iku", en: "I'm going too." },
          { jp: "ねこも いぬも すきだ", r: "neko mo inu mo suki da", en: "(I) like both cats and dogs." },
        ],
      },
    ],
    quiz: [
      {
        q: "“There's a cat and a dog”, the complete list. Which fits?",
        jp: "ねこ＿ いぬが いる",
        choices: ["や", "と", "も", "の"],
        answer: 1,
        why: "と lists everything there is; や would mean “among other animals”.",
      },
      {
        q: "What does パンや たまごを かう suggest?",
        jp: "パンや たまごを かう",
        choices: [
          "Bread and eggs, exactly",
          "Bread, eggs, and other things besides",
          "Bread or eggs, choose one",
          "Neither bread nor eggs",
        ],
        answer: 1,
        why: "や leaves the list open, “things like bread and eggs”.",
      },
      {
        q: "How do you say “I'm going too”?",
        choices: ["わたしがも いく", "わたしも いく", "わたしとも いく", "わたしはも いく"],
        answer: 1,
        why: "も replaces が entirely, never がも.",
      },
      {
        q: "What does さくらと はなす mean?",
        jp: "さくらと はなす",
        choices: ["(I) talk about Sakura", "(I) talk with Sakura", "Sakura talks alone", "(I) talk instead of Sakura"],
        answer: 1,
        why: "と after a person means together with them.",
      },
      {
        q: "ねこも いぬも すきだ, what's the shape?",
        jp: "ねこも いぬも すきだ",
        choices: ["Either cats or dogs", "Both cats and dogs", "Cats but not dogs", "Cats more than dogs"],
        answer: 1,
        why: "も…も… means “both… and…”.",
      },
    ],
  },
  // ---------------------------------------------------------------- 9
  {
    title: "の: belonging and describing",
    tagline: "One tiny word does everything English does with “'s” and “of”.",
    sections: [
      {
        heading: "A の B: B belongs to A",
        body:
          "の links two things, and the first one owns or frames the second: わたしの ほん, my book. さくらの " +
          "ねこ. Sakura's cat. Read A の B as “B of A” and the order never trips you.",
        examples: [
          { jp: "わたしの ほん", r: "watashi no hon", en: "my book" },
          { jp: "さくらの ねこ", r: "sakura no neko", en: "Sakura's cat" },
        ],
      },
      {
        heading: "の also describes",
        body:
          "The link is looser than owning, the first word can simply describe the second: にほんごの ほん (a " +
          "Japanese-language book), がっこうの ともだち (a friend from school). Any thing can dress up another " +
          "thing this way.",
        examples: [
          { jp: "にほんごの ほん", r: "nihongo no hon", en: "a Japanese book (a book of Japanese)" },
          { jp: "がっこうの ともだち", r: "gakkou no tomodachi", en: "a friend from school" },
        ],
      },
      {
        heading: "の can stand in for a thing",
        body:
          "Once the thing is obvious, の can replace it entirely: あかいのが すきだ, “I like the red ONE.” " +
          "The の holds the place of the thing you'd otherwise repeat.",
        examples: [
          { jp: "あかいのが すきだ", r: "akai no ga suki da", en: "(I) like the red one." },
          { jp: "わたしのだ", r: "watashi no da", en: "(It's) mine." },
        ],
      },
    ],
    quiz: [
      {
        q: "How do you say “Sakura's dog”?",
        choices: ["いぬの さくら", "さくらの いぬ", "さくらが いぬ", "さくらと いぬ"],
        answer: 1,
        why: "Owner first, thing second: A の B is “A's B”.",
      },
      {
        q: "What is にほんごの ほん?",
        jp: "にほんごの ほん",
        choices: ["A book that owns Japanese", "A Japanese-language book", "Japanese and a book", "A book about owning"],
        answer: 1,
        why: "の also just describes: a book of Japanese.",
      },
      {
        q: "What does わたしのだ mean?",
        jp: "わたしのだ",
        choices: ["I am here", "(It's) mine", "It's me", "My turn"],
        answer: 1,
        why: "の stands in for the obvious thing: “(it) is mine.”",
      },
      {
        q: "“I like the red one.” Which is right?",
        choices: ["あかいが すきだ", "あかいのが すきだ", "あかいをが すきだ", "あかいだが すき"],
        answer: 1,
        why: "の holds the place of the thing that is red.",
      },
      {
        q: "In いぬの ボール, whose ball is it?",
        jp: "いぬの ボール",
        choices: ["The ball's", "The dog's", "Nobody's", "Mine"],
        answer: 1,
        why: "The first word owns the second: the dog's ball.",
      },
    ],
  },
  // ---------------------------------------------------------------- 10
  {
    title: "か・ね・よ: asking and nudging",
    tagline: "The particles that sit at the very end and set the sentence's tone.",
    sections: [
      {
        heading: "か turns anything into a question",
        body:
          "No do-you, no word flipping: put か on the end and the sentence becomes a question. ねこですか, " +
          "is it a cat? In casual speech the か often drops and the voice just rises: ねこ？",
        examples: [
          { jp: "ねこですか", r: "neko desu ka", en: "Is it a cat?" },
          { jp: "いきますか", r: "ikimasu ka", en: "Are (you) going?" },
        ],
      },
      {
        heading: "ね reaches for agreement",
        body:
          "ね at the end is “…right?” or “…isn't it?”. It invites the listener to nod along. あついですね, hot " +
          "today, isn't it. Japanese conversation runs on ね the way English runs on small talk.",
        examples: [
          { jp: "あついですね", r: "atsui desu ne", en: "Hot, isn't it?" },
          { jp: "かわいいね", r: "kawaii ne", en: "Cute, right?" },
        ],
      },
      {
        heading: "よ hands over news",
        body:
          "よ marks what you're saying as news to the listener, “I'm telling you.” バスが きたよ, the bus is " +
          "here (you didn't seem to notice). Use it gently; too much よ sounds pushy.",
        examples: [
          { jp: "バスが きたよ", r: "basu ga kita yo", en: "The bus is here, you know." },
          { jp: "おいしいよ", r: "oishii yo", en: "It's good, trust me." },
        ],
      },
    ],
    quiz: [
      {
        q: "How do you turn ねこです into a question?",
        choices: ["ですねこか", "ねこですか", "かねこです", "ねこのです"],
        answer: 1,
        why: "か goes on the very end, and that's the whole trick.",
      },
      {
        q: "あついですね, what is the speaker doing?",
        jp: "あついですね",
        choices: ["Giving orders", "Inviting you to agree it's hot", "Asking if it's hot", "Complaining angrily"],
        answer: 1,
        why: "ね looks for a nod: “…isn't it?”",
      },
      {
        q: "When does よ fit best?",
        choices: [
          "When the listener already knows",
          "When you're telling them something they don't know",
          "In every sentence",
          "Only in questions",
        ],
        answer: 1,
        why: "よ flags news: “I'm telling you.”",
      },
      {
        q: "What does いきますか ask?",
        jp: "いきますか",
        choices: ["Did you eat?", "Are (you) going?", "Where is it?", "Who's going?"],
        answer: 1,
        why: "いきます (going, politely) + か (question).",
      },
      {
        q: "Which ending would you add to tell a friend the bus arrived, news to them?",
        jp: "バスが きた＿",
        choices: ["ね", "よ", "か", "の"],
        answer: 1,
        why: "News they don't have yet is よ's whole job.",
      },
    ],
  },
  // ---------------------------------------------------------------- 11
  {
    title: "から・まで: from, until, because",
    tagline: "Where things start, where they stop, and why they happen.",
    sections: [
      {
        heading: "から: the starting point",
        body:
          "から marks where or when something starts: えきから (from the station), 9じから (from nine " +
          "o'clock). Anything with a beginning can wear it.",
        examples: [
          { jp: "でんしゃが えきから でる", r: "densha ga eki kara deru", en: "The train leaves from the station." },
          { jp: "9じから はたらく", r: "ku-ji kara hataraku", en: "(I) work from nine." },
        ],
      },
      {
        heading: "まで: the far edge",
        body:
          "まで marks how far something goes, in space or time: えきまで あるく (walk as far as the station), " +
          "よるまで はたらく (work until night). から and まで love to travel as a pair.",
        examples: [
          { jp: "えきまで あるく", r: "eki made aruku", en: "(I) walk to the station." },
          { jp: "あさから よるまで はたらく", r: "asa kara yoru made hataraku", en: "(I) work from morning until night." },
        ],
      },
      {
        heading: "から after a sentence: because",
        body:
          "Hang から on a whole sentence and it gives the reason for what follows: さむいから、うちに いる, " +
          "it's cold, SO I'm staying home. The reason comes first, the result after, the reverse of English " +
          "“because”.",
        examples: [
          { jp: "さむいから、うちに いる", r: "samui kara, uchi ni iru", en: "It's cold, so (I'm) staying home." },
          { jp: "たかいから、かわない", r: "takai kara, kawanai", en: "It's expensive, so (I) won't buy it." },
        ],
      },
    ],
    quiz: [
      {
        q: "“(I) work from morning until night.” Which pair fits?",
        jp: "あさ＿ よる＿ はたらく",
        choices: ["に・で", "から・まで", "まで・から", "と・や"],
        answer: 1,
        why: "から starts it, まで ends it, in that order.",
      },
      {
        q: "What does えきまで あるく mean?",
        jp: "えきまで あるく",
        choices: ["(I) walk from the station", "(I) walk as far as the station", "(I) walk at the station", "The station walks"],
        answer: 1,
        why: "まで is the far edge, how far the walking goes.",
      },
      {
        q: "さむいから、うちに いる, what does から do here?",
        jp: "さむいから、うちに いる",
        choices: ["Marks a starting place", "Gives the reason, because it's cold", "Asks a question", "Marks the doer"],
        answer: 1,
        why: "After a whole sentence, から means “because / so”.",
      },
      {
        q: "In Japanese, does the reason come before or after the result?",
        choices: ["After, like English “because”", "Before, reason first, then the result", "Either, freely", "Reasons need a new sentence"],
        answer: 1,
        why: "さむいから、うちに いる: cold first, staying home second.",
      },
      {
        q: "“The train leaves from the station.” Which fits?",
        jp: "でんしゃが えき＿ でる",
        choices: ["まで", "から", "を", "の"],
        answer: 1,
        why: "The station is where the leaving starts, から.",
      },
    ],
  },
  // ---------------------------------------------------------------- 12
  {
    title: "Verbs and their groups",
    tagline: "Two families plus two rebels, and the polite ます form.",
    sections: [
      {
        heading: "Every verb ends in an u-sound",
        body:
          "In dictionary form, every Japanese verb ends with an u-sound kana: たべる, かく, のむ, はなす. That " +
          "plain form is a real, usable ending, たべる is “(I) eat / will eat” among friends. There is no " +
          "future tense to learn; plain form covers now and later.",
        examples: [
          { jp: "あした いく", r: "ashita iku", en: "(I'll) go tomorrow., plain form, future meaning" },
        ],
      },
      {
        heading: "The two families",
        body:
          "Verbs conjugate in two patterns. る-group verbs (like たべる, みる) drop る and take endings: たべ→ " +
          "たべます. う-group verbs (like かく, のむ, and many ending in る!) shift their last sound instead: " +
          "かく→かき→かきます. Which family a る-ending verb belongs to has to be learned, the playground " +
          "tab is built for exactly that experimenting.",
        examples: [
          { jp: "たべる → たべます", r: "taberu → tabemasu", en: "eat, る-group: る drops off" },
          { jp: "かく → かきます", r: "kaku → kakimasu", en: "write, う-group: く shifts to き" },
          { jp: "のむ → のみます", r: "nomu → nomimasu", en: "drink, う-group: む shifts to み" },
        ],
      },
      {
        heading: "The two rebels: する and くる",
        body:
          "する (do) and くる (come) follow nobody: する→します, くる→きます. They are the only two truly " +
          "irregular verbs in the language, and する is everywhere, because thing+する builds verbs: " +
          "べんきょうする (study), りょこうする (travel).",
        examples: [
          { jp: "べんきょうする → べんきょうします", r: "benkyou suru → benkyou shimasu", en: "study, the する rebel" },
          { jp: "くる → きます", r: "kuru → kimasu", en: "come, the くる rebel" },
        ],
      },
      {
        heading: "ます: polite, and a doorway",
        body:
          "The ます form is the polite present/future: たべます, いきます. Beyond politeness it matters because " +
          "its stem (たべ, いき) is the hook many other endings hang on, you'll meet it again with たい (want " +
          "to) and ましょう (let's).",
        examples: [
          { jp: "まいにち みずを のみます", r: "mainichi mizu wo nomimasu", en: "(I) drink water every day., polite" },
        ],
      },
    ],
    quiz: [
      {
        q: "What sound does every dictionary-form verb end with?",
        choices: ["an a-sound", "an i-sound", "a u-sound", "ん"],
        answer: 2,
        why: "たべる, かく, のむ, はなす, all u-row kana.",
      },
      {
        q: "How does a る-group verb like みる become polite?",
        choices: ["みるます", "みります", "みます", "みくます"],
        answer: 2,
        why: "る-group: drop る, add ます.",
      },
      {
        q: "How does かく (う-group) become polite?",
        choices: ["かくます", "かきます", "かします", "かけます"],
        answer: 1,
        why: "う-group: the last sound shifts to its i-row, く→き, then ます.",
      },
      {
        q: "Which two verbs are the true irregulars?",
        choices: ["いく and くる", "する and くる", "たべる and みる", "ある and いる"],
        answer: 1,
        why: "する→します and くる→きます follow no pattern; everything else does.",
      },
      {
        q: "Does あした たべる need a future tense marker?",
        jp: "あした たべる",
        choices: ["Yes, add でしょう", "No, plain form already covers the future", "Yes, add ました", "It's ungrammatical"],
        answer: 1,
        why: "Plain form is now AND later; あした does the time-setting.",
      },
    ],
  },
  // ---------------------------------------------------------------- 13
  {
    title: "Saying no, and saying yesterday",
    tagline: "ない and た, the two bends every ending takes.",
    sections: [
      {
        heading: "ない: not",
        body:
          "To say something doesn't happen, verbs bend to ない: たべる→たべない (don't eat). る-group verbs " +
          "swap る for ない; う-group verbs shift to their a-row first: かく→かかない, のむ→のまない. A word " +
          "ending in ない then behaves exactly like an い describing word, remember that, it pays off " +
          "immediately.",
        examples: [
          { jp: "たべる → たべない", r: "taberu → tabenai", en: "eat → don't eat" },
          { jp: "かく → かかない", r: "kaku → kakanai", en: "write → don't write" },
        ],
      },
      {
        heading: "た: it already happened",
        body:
          "The past is the た form: たべる→たべた (ate). る-group swaps る for た. う-group endings pair up " +
          "the same way they do for て (next lesson): かく→かいた, のむ→のんだ, かう→かった.",
        examples: [
          { jp: "たべた", r: "tabeta", en: "(I) ate." },
          { jp: "のんだ", r: "nonda", en: "(I) drank." },
        ],
      },
      {
        heading: "The bends stack",
        body:
          "Didn't happen, in the past? ない first, then bend the ない like an い-word: たべない→たべなかった " +
          "(didn't eat). Politely, ます has its own set: たべません (don't eat), たべました (ate), たべません" +
          "でした (didn't eat). Four plain forms, four polite forms, that's the whole tense system.",
        examples: [
          { jp: "たべなかった", r: "tabenakatta", en: "(I) didn't eat." },
          { jp: "たべませんでした", r: "tabemasen deshita", en: "(I) didn't eat., polite" },
        ],
      },
    ],
    quiz: [
      {
        q: "How do you say “don't drink” plainly? (のむ is う-group)",
        choices: ["のむない", "のまない", "のみない", "のめない"],
        answer: 1,
        why: "う-group shifts to the a-row before ない: む→ま.",
      },
      {
        q: "What is たべた?",
        jp: "たべた",
        choices: ["(I) will eat", "(I) ate", "(I) don't eat", "Let's eat"],
        answer: 1,
        why: "た is the past: ate.",
      },
      {
        q: "How do you say “didn't eat” plainly?",
        choices: ["たべないた", "たべなかった", "たべたない", "たべませんでした"],
        answer: 1,
        why: "ない bends like an い-word: ない→なかった. (ませんでした is the polite version.)",
      },
      {
        q: "A word ending in ない behaves like…",
        choices: ["a thing word", "an い describing word", "a particle", "a name"],
        answer: 1,
        why: "That's why ない→なかった works exactly like あかい→あかかった.",
      },
      {
        q: "What is the polite past of いきます?",
        choices: ["いきますた", "いきました", "いきません", "いった"],
        answer: 1,
        why: "ます→ました is the polite past.",
      },
    ],
  },
  // ---------------------------------------------------------------- 14
  {
    title: "The て form: the connector",
    tagline: "One shape, three superpowers: joining, asking, and right-now.",
    sections: [
      {
        heading: "What て looks like",
        body:
          "る-group: swap る for て (たべる→たべて). う-group endings pair up: う・つ・る→って (かう→かって), " +
          "む・ぬ・ぶ→んで (のむ→のんで), く→いて (かく→かいて), ぐ→いで, す→して. する→して, くる→きて, and " +
          "the one oddball: いく→いって.",
        examples: [
          { jp: "たべる → たべて", r: "taberu → tabete", en: "eat → eating-and…" },
          { jp: "のむ → のんで", r: "nomu → nonde", en: "drink → drinking-and…" },
          { jp: "いく → いって", r: "iku → itte", en: "go → going-and… (the oddball)" },
        ],
      },
      {
        heading: "Superpower 1: joining sentences",
        body:
          "A て form doesn't finish a sentence, it hooks it to the next one: パンを たべて、みずを のむ, " +
          "(I) eat bread and drink water. Chain as many as you like; the real ending still comes last and " +
          "carries the tense for the whole chain.",
        examples: [
          { jp: "パンを たべて、みずを のむ", r: "pan wo tabete, mizu wo nomu", en: "(I) eat bread and drink water." },
          { jp: "おきて、がっこうに いった", r: "okite, gakkou ni itta", en: "(I) got up and went to school., the last word sets the past" },
        ],
      },
      {
        heading: "Superpower 2: asking, てください",
        body: "て plus ください asks politely: みてください, please look. まってください, please wait.",
        examples: [
          { jp: "みてください", r: "mite kudasai", en: "Please look." },
          { jp: "ちょっと まってください", r: "chotto matte kudasai", en: "Please wait a moment." },
        ],
      },
      {
        heading: "Superpower 3: right now, ている",
        body:
          "て plus いる means the action is in progress: たべている, (I'm) eating. And because the result " +
          "ends in る, it's a る-group verb again, ready for every bend you know: たべています, たべていない, " +
          "たべていた.",
        examples: [
          { jp: "ねこが ねている", r: "neko ga nete iru", en: "The cat is sleeping." },
          { jp: "ほんを よんでいる", r: "hon wo yonde iru", en: "(I'm) reading a book." },
        ],
      },
    ],
    quiz: [
      {
        q: "What is the て form of のむ?",
        choices: ["のみて", "のんで", "のって", "のて"],
        answer: 1,
        why: "む goes to んで: のんで.",
      },
      {
        q: "Which verb breaks the く→いて rule?",
        choices: ["かく", "きく", "いく", "あるく"],
        answer: 2,
        why: "いく→いって, the one exception.",
      },
      {
        q: "What does ねこが ねている mean?",
        jp: "ねこが ねている",
        choices: ["The cat slept", "The cat is sleeping", "The cat will sleep", "Please sleep, cat"],
        answer: 1,
        why: "ている is the action in progress.",
      },
      {
        q: "How do you politely ask someone to wait? (まつ → て form)",
        choices: ["まつください", "まってください", "まちください", "またください"],
        answer: 1,
        why: "つ goes to って, then ください: まってください.",
      },
      {
        q: "In おきて、がっこうに いった, what tense is the getting up?",
        jp: "おきて、がっこうに いった",
        choices: ["Present, always", "Past, the final いった sets it for the whole chain", "Future", "It has no tense"],
        answer: 1,
        why: "て forms borrow their tense from the sentence's real ending.",
      },
    ],
  },
  // ---------------------------------------------------------------- 15
  {
    title: "Describing words: い and な",
    tagline: "One kind has “is” built in; the other borrows だ.",
    sections: [
      {
        heading: "い-words carry their own “is”",
        body:
          "Words like あかい, おおきい, たのしい end in い and already contain “is”, あかい alone means “(it) " +
          "is red”, a full sentence. In front of a thing they describe it directly: あかい はな, a red flower.",
        examples: [
          { jp: "この ほんは おもしろい", r: "kono hon wa omoshiroi", en: "This book is interesting., no だ needed" },
          { jp: "あかい はなが さく", r: "akai hana ga saku", en: "A red flower blooms." },
        ],
      },
      {
        heading: "い-words bend like verbs do",
        body:
          "Drop the い and bend: あかくない (isn't red), あかかった (was red), あかくなかった (wasn't red), " +
          "あかくて (red and…). One warning: never put だ after an い-word, the “is” is already inside.",
        examples: [
          { jp: "たかくない", r: "takakunai", en: "isn't expensive" },
          { jp: "たのしかった", r: "tanoshikatta", en: "was fun" },
        ],
      },
      {
        heading: "な-words borrow everything",
        body:
          "Words like きれい, しずか, げんき are really thing-words at heart. To end a sentence they borrow だ " +
          "(うみが しずかだ), and to sit in front of a thing they wear な: しずかな うみ, a quiet sea. That " +
          "な is where the name comes from. Watch out: きれい ends in い but is a な-word, きれいな はな.",
        examples: [
          { jp: "うみが しずかだ", r: "umi ga shizuka da", en: "The sea is quiet." },
          { jp: "しずかな うみ", r: "shizuka na umi", en: "a quiet sea" },
          { jp: "きれいな はな", r: "kirei na hana", en: "a pretty flower, きれい is a な-word in disguise" },
        ],
      },
      {
        heading: "Their past and negative ride on だ",
        body:
          "な-words bend by bending the borrowed だ: しずかだった (was quiet), しずかじゃない (isn't quiet), " +
          "しずかじゃなかった (wasn't quiet). Same machinery as plain things, because that's what they are.",
        examples: [
          { jp: "げんきじゃない", r: "genki ja nai", en: "isn't doing well" },
          { jp: "きれいだった", r: "kirei datta", en: "was pretty" },
        ],
      },
    ],
    quiz: [
      {
        q: "Which needs な to describe a thing?",
        choices: ["あかい", "おおきい", "しずか", "たのしい"],
        answer: 2,
        why: "しずかな うみ, な-words wear な in front of things; い-words attach bare.",
      },
      {
        q: "“This book is interesting.” Which is right?",
        choices: ["この ほんは おもしろいだ", "この ほんは おもしろい", "この ほんは おもしろいです だ", "この ほんは おもしろな"],
        answer: 1,
        why: "い-words never take だ, the “is” is built in.",
      },
      {
        q: "What is the past of たのしい?",
        choices: ["たのしいでした", "たのしかった", "たのしいだった", "たのしいた"],
        answer: 1,
        why: "Drop い, add かった.",
      },
      {
        q: "きれい describes a flower as…",
        choices: ["きれい はな", "きれいな はな", "きれいい はな", "きれいの はな"],
        answer: 1,
        why: "きれい ends in い but is a な-word, きれいな はな.",
      },
      {
        q: "“The sea isn't quiet.” Which is right?",
        choices: ["うみが しずかくない", "うみが しずかじゃない", "うみが しずかないだ", "うみが しずかでないい"],
        answer: 1,
        why: "な-words negate through their borrowed だ: じゃない.",
      },
    ],
  },
  // ---------------------------------------------------------------- 16
  {
    title: "The rest of the particle family",
    tagline: "だけ, しか, ぐらい, ごろ, とか, けど, し: small words you'll meet every day.",
    sections: [
      {
        heading: "だけ and しか: only, two ways",
        body:
          "だけ means “only”, plainly: みずだけ のむ. I drink only water. しか also means “only” but demands a " +
          "negative ending and adds a note of “no more than that”: みずしか のまない. I drink nothing but " +
          "water. だけ counts what's there; しか laments what isn't.",
        examples: [
          { jp: "みずだけ のむ", r: "mizu dake nomu", en: "(I) drink only water." },
          { jp: "みずしか のまない", r: "mizu shika nomanai", en: "(I) drink nothing but water." },
        ],
      },
      {
        heading: "ぐらい and ごろ: about",
        body:
          "ぐらい (or くらい) is “about” for amounts: 3じかんぐらい, about three hours. ごろ is “about” for " +
          "points in time: 3じごろ, around three o'clock. Amounts take ぐらい, clock-points take ごろ.",
        examples: [
          { jp: "3じかんぐらい べんきょうする", r: "san-jikan gurai benkyou suru", en: "(I) study about three hours." },
          { jp: "3じごろ かえる", r: "san-ji goro kaeru", en: "(I'll) head back around three." },
        ],
      },
      {
        heading: "とか: loose examples",
        body:
          "とか lists like や but even more casually, “like, stuff such as”: すしとか ラーメンとか たべる, " +
          "I eat sushi, ramen, that kind of thing. Everyday speech leans on it constantly.",
        examples: [
          { jp: "すしとか ラーメンとか たべる", r: "sushi toka raamen toka taberu", en: "(I) eat things like sushi and ramen." },
        ],
      },
      {
        heading: "けど and し: but, and what's more",
        body:
          "けど hooks two sentences with a “but”: たかいけど、かう, it's expensive, but I'm buying it. し " +
          "stacks reasons: やすいし、おいしいし, it's cheap, AND it's tasty (so of course). Both sit on the " +
          "end of a finished thought, like から does.",
        examples: [
          { jp: "たかいけど、かう", r: "takai kedo, kau", en: "It's expensive, but (I'll) buy it." },
          { jp: "やすいし、おいしい", r: "yasui shi, oishii", en: "It's cheap, and tasty too." },
        ],
      },
    ],
    quiz: [
      {
        q: "Which “only” insists on a negative ending?",
        choices: ["だけ", "しか", "ぐらい", "とか"],
        answer: 1,
        why: "しか must pair with ない: みずしか のまない.",
      },
      {
        q: "“Around three o'clock”, which fits?",
        jp: "3じ＿ かえる",
        choices: ["ぐらい", "ごろ", "だけ", "まで"],
        answer: 1,
        why: "Clock-points take ごろ; amounts (three hours' worth) take ぐらい.",
      },
      {
        q: "What does たかいけど、かう mean?",
        jp: "たかいけど、かう",
        choices: [
          "It's expensive, so I won't buy it",
          "It's expensive, but I'll buy it",
          "It's cheap, so I'll buy it",
          "Is it expensive?",
        ],
        answer: 1,
        why: "けど is the hook that means “but”.",
      },
      {
        q: "みずしか のまない says…",
        jp: "みずしか のまない",
        choices: ["(I) don't drink water", "(I) drink nothing but water", "(I) drink lots of water", "Water is undrinkable"],
        answer: 1,
        why: "しか + negative = only, with a shrug: nothing beyond water.",
      },
      {
        q: "What does し do in やすいし、おいしい?",
        jp: "やすいし、おいしい",
        choices: ["Contrasts the two", "Stacks reasons, cheap, AND tasty", "Makes it a question", "Marks the past"],
        answer: 1,
        why: "し piles up reasons that point the same way.",
      },
    ],
  },
  // ---------------------------------------------------------------- 17
  {
    title: "Reading between the lines",
    tagline: "The unsaid doer, sentences describing things, and everything joined up.",
    sections: [
      {
        heading: "The invisible ones, on purpose",
        body:
          "By now you've seen it everywhere: Japanese leaves out whatever context already answers. Doers, " +
          "objects, even whole topics vanish. たべた？ たべた。 is a complete conversation, “Did (you) eat?” " +
          "“(I) ate.” When a sentence looks like it's missing something, it is, and that's fine. Ask who or " +
          "what it must be about, and the answer is almost always sitting in the situation.",
        examples: [
          { jp: "たべた？", r: "tabeta?", en: "Did (you) eat?" },
          { jp: "たべた", r: "tabeta", en: "(I) ate." },
        ],
      },
      {
        heading: "A sentence can describe a thing",
        body:
          "Park a whole little sentence in front of a thing and it describes it, no “who” or “that” needed: " +
          "さくらが よんだ ほん, the book Sakura read (literally: the Sakura-read book). English builds a " +
          "clause after the noun; Japanese stacks it before, in exactly the spot describing words go.",
        examples: [
          { jp: "さくらが よんだ ほん", r: "sakura ga yonda hon", en: "the book Sakura read" },
          { jp: "ねている ねこは かわいい", r: "nete iru neko wa kawaii", en: "The sleeping cat is cute." },
        ],
      },
      {
        heading: "Now watch a real sentence come apart",
        body:
          "きのう ともだちと えいがを みて、ラーメンを たべた。 Yesterday, (I) watched a film with a friend and " +
          "ate ramen. Every piece is machinery you now own: きのう (time, no particle), ともだちと (with), " +
          "えいがを (what got watched), みて (watched-and…), ラーメンを, たべた (the real ending, past). The " +
          "doer? Unsaid. Obviously me.",
        examples: [
          {
            jp: "きのう ともだちと えいがを みて、ラーメンを たべた",
            r: "kinou tomodachi to eiga wo mite, raamen wo tabeta",
            en: "Yesterday (I) watched a film with a friend and ate ramen.",
          },
        ],
      },
      {
        heading: "Where to go from here",
        body:
          "Practice runs you through drills on all of this. Playground lets you bend any word you meet. Parse " +
          "takes apart any real sentence you paste in. And the Dictionary holds every pattern through JLPT N1 " +
          "for the day you meet it in the wild. The grammar you just learned is the whole skeleton, " +
          "everything from here is vocabulary and mileage.",
      },
    ],
    quiz: [
      {
        q: "たべた？, what is unsaid but understood?",
        jp: "たべた？",
        choices: ["The doer, “you”", "The verb", "The past tense", "Nothing"],
        answer: 0,
        why: "Asked to your face, the eater can only be you, so Japanese drops it.",
      },
      {
        q: "What is さくらが よんだ ほん?",
        jp: "さくらが よんだ ほん",
        choices: ["Sakura read a book", "the book Sakura read", "Sakura's favourite book", "a book about Sakura"],
        answer: 1,
        why: "The little sentence さくらが よんだ parks in front of ほん and describes it.",
      },
      {
        q: "Where does a describing sentence sit, relative to its thing?",
        choices: ["After it, like English", "Before it, where all describers go", "At the sentence's end", "Anywhere"],
        answer: 1,
        why: "Describers come right before what they describe, sentences included.",
      },
      {
        q: "In きのう ともだちと えいがを みて、ラーメンを たべた, who did it?",
        jp: "きのう ともだちと えいがを みて、ラーメンを たべた",
        choices: ["The friend", "The speaker, unsaid", "The ramen", "Sakura"],
        answer: 1,
        why: "No doer is stated, so context supplies the obvious one: the speaker.",
      },
      {
        q: "What tense is みて in that sentence?",
        choices: ["Present, fixed", "It borrows the past from たべた at the end", "Future", "None, it's a noun"],
        answer: 1,
        why: "て forms lean on the real ending, and たべた is past.",
      },
    ],
  },
];
