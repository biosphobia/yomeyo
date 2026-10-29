import type { GenkiLesson } from "./genki-data.js";

/**
 * Units 3 and 4: Genki Lesson 3 (デートのやくそく, Making a Date) and
 * Lesson 4 (はじめてのデート, The First Date). Same shape and rules as
 * units 1 and 2 in genki-data.ts: everything written for the app, kana in
 * the sentences, the standard kanji spelling shown beside each word in the
 * vocabulary list (Genki starts writing kanji from Lesson 3; the Kanji tab
 * is where to learn them).
 */

// ====================================================================
// Unit 3 · Genki Lesson 3 · デートのやくそく (Making a Date)
// ====================================================================

export const L3: GenkiLesson = {
  id: "l3",
  num: 3,
  jp: "デートのやくそく",
  en: "Making a Date",
  pages: "Genki I pp. 82–101",
  goals: [
    "Use verbs in the polite present: ます and ません",
    "Tell which of the three verb groups a verb belongs to",
    "Say what you do, where, and when, with を, で, に and へ",
    "Talk about how often you do things",
    "Invite someone, and accept or turn down an invitation",
  ],
  plan: [
    "1 · Vocabulary, Grammar 1: the three verb groups",
    "2 · Grammar 2–3: present tense, を で に へ",
    "3 · Grammar 4–5: time words, 〜ませんか",
    "4 · Grammar 6–8: frequency, word order, は for topics",
    "5 · Conversations, reading, unit test",
  ],
  practice: [
    { title: "Verbs", games: ["verb-class", "masu-form"] },
    { title: "Sentences", games: ["particles-u3", "time-ni", "frequency", "u3-builder"] },
    { title: "Listening", games: ["schedule-listen"] },
    { title: "Reading", games: ["reading-u3"] },
    { title: "Role play", games: ["invite"] },
    { title: "Words", games: ["vocab-l3"] },
  ],
  vocab: [
    {
      title: "Entertainment and sports",
      words: [
        { jp: "えいが", kanji: "映画", en: "movie", star: true },
        { jp: "おんがく", kanji: "音楽", en: "music" },
        { jp: "ざっし", kanji: "雑誌", en: "magazine" },
        { jp: "スポーツ", en: "sports" },
        { jp: "デート", en: "date (romantic)" },
        { jp: "テニス", en: "tennis" },
        { jp: "テレビ", en: "TV" },
      ],
    },
    {
      title: "Food and drink",
      words: [
        { jp: "アイスクリーム", en: "ice cream" },
        { jp: "ハンバーガー", en: "hamburger" },
        { jp: "おさけ", kanji: "お酒", en: "sake; alcohol" },
        { jp: "おちゃ", kanji: "お茶", en: "green tea" },
        { jp: "コーヒー", en: "coffee" },
        { jp: "みず", kanji: "水", en: "water" },
        { jp: "あさごはん", kanji: "朝ご飯", en: "breakfast" },
        { jp: "ひるごはん", kanji: "昼ご飯", en: "lunch" },
        { jp: "ばんごはん", kanji: "晩ご飯", en: "dinner", star: true },
      ],
    },
    {
      title: "Places",
      words: [
        { jp: "いえ", kanji: "家", en: "home; house" },
        { jp: "うち", en: "home; my place", star: true },
        { jp: "がっこう", kanji: "学校", en: "school" },
        { jp: "カフェ", en: "café" },
      ],
    },
    {
      title: "Time",
      words: [
        { jp: "あした", kanji: "明日", en: "tomorrow" },
        { jp: "きょう", kanji: "今日", en: "today", star: true },
        { jp: "あさ", kanji: "朝", en: "morning" },
        { jp: "こんばん", kanji: "今晩", en: "tonight" },
        { jp: "まいにち", kanji: "毎日", en: "every day" },
        { jp: "まいばん", kanji: "毎晩", en: "every night" },
        { jp: "しゅうまつ", kanji: "週末", en: "weekend", star: true },
        { jp: "どようび", kanji: "土曜日", en: "Saturday", star: true },
        { jp: "にちようび", kanji: "日曜日", en: "Sunday", star: true },
        { jp: "いつ", en: "when" },
        { jp: "〜ごろ", en: "at about (a time)", star: true },
      ],
    },
    {
      title: "U-verbs",
      words: [
        { jp: "いく", kanji: "行く", en: "to go (に／へ)", star: true },
        { jp: "かえる", kanji: "帰る", en: "to go back, return (に／へ)", star: true },
        { jp: "きく", kanji: "聞く", en: "to listen, hear (を)" },
        { jp: "のむ", kanji: "飲む", en: "to drink (を)" },
        { jp: "はなす", kanji: "話す", en: "to speak, talk (を／で)" },
        { jp: "よむ", kanji: "読む", en: "to read (を)" },
      ],
    },
    {
      title: "Ru-verbs",
      words: [
        { jp: "おきる", kanji: "起きる", en: "to get up" },
        { jp: "たべる", kanji: "食べる", en: "to eat (を)", star: true },
        { jp: "ねる", kanji: "寝る", en: "to sleep, go to bed" },
        { jp: "みる", kanji: "見る", en: "to see, watch (を)", star: true },
      ],
    },
    {
      title: "Irregular verbs",
      words: [
        { jp: "くる", kanji: "来る", en: "to come (に／へ)" },
        { jp: "する", en: "to do (を)", star: true },
        { jp: "べんきょうする", kanji: "勉強する", en: "to study (を)", star: true },
      ],
    },
    {
      title: "Adjectives and adverbs",
      words: [
        { jp: "いい", en: "good", star: true },
        { jp: "はやい", kanji: "早い", en: "early", star: true },
        { jp: "あまり", en: "not much (+ negative)" },
        { jp: "ぜんぜん", kanji: "全然", en: "not at all (+ negative)" },
        { jp: "たいてい", en: "usually", star: true },
        { jp: "ちょっと", en: "a little", star: true },
        { jp: "ときどき", kanji: "時々", en: "sometimes", star: true },
        { jp: "よく", en: "often; much" },
      ],
    },
    {
      title: "Expressions",
      words: [
        { jp: "そうですね", en: "That's right. / Let me see.", star: true },
        { jp: "でも", en: "but", star: true },
        { jp: "どうですか", en: "How about…? / How is…?", star: true },
        { jp: "ええ", en: "yes", star: true },
      ],
    },
  ],
  steps: [
    // ------------------------------------------------ grammar 1
    {
      id: "verbs",
      kind: "grammar",
      title: "Verb conjugation",
      name: "Grammar 1 · The three verb groups",
      genki: "Genki pp. 86–88",
      teach:
        "Every verb has a **dictionary form**, the form listed in the dictionary: たべる, のむ, する. To say it politely you change it to the **ます form**. How you change it depends on which of three groups the verb belongs to.\n\n" +
        "**Ru-verbs** end in -iru or -eru (いる or える sounds before る). Drop る and add ます: たべる → たべます, みる → みます.\n\n" +
        "**U-verbs** are all the others. Change the last sound from the う column to the い column of the same row, and add ます: のむ → のみます, いく → いきます, はなす → はなします, かえる → かえります.\n\n" +
        "**Irregular verbs**: する → します and くる → きます. Nouns + する work like する: べんきょうする → べんきょうします.\n\n" +
        "For the negative, use **ません** instead of ます: たべません, のみません, しません, きません.\n\n" +
        "A verb ending in -aru, -oru or -uru is never a ru-verb. A verb ending in -iru or -eru is usually a ru-verb, but not always: かえる is a u-verb. Learn each verb with its ます form (かえる · かえります) and you won't need to guess.",
      tables: [
        {
          caption: "This lesson's verbs",
          rows: [
            ["to eat (ru)", "たべる → たべます"],
            ["to see (ru)", "みる → みます"],
            ["to get up (ru)", "おきる → おきます"],
            ["to sleep (ru)", "ねる → ねます"],
            ["to go (u)", "いく → いきます"],
            ["to return (u)", "かえる → かえります", "looks like ru"],
            ["to listen (u)", "きく → ききます"],
            ["to drink (u)", "のむ → のみます"],
            ["to speak (u)", "はなす → はなします"],
            ["to read (u)", "よむ → よみます"],
            ["to come (irr.)", "くる → きます"],
            ["to do (irr.)", "する → します"],
            ["to study (irr.)", "べんきょうする → べんきょうします"],
          ],
        },
      ],
      examples: [
        { jp: "まいにち コーヒーを のみます。", en: "I drink coffee every day." },
        { jp: "あさごはんを たべません。", en: "I don't eat breakfast." },
        { jp: "はるとさんは テニスを します。", en: "Haruto plays tennis." },
        { jp: "うちに かえります。", en: "I'll go home." },
      ],
      watch: [
        "かえる is a u-verb: かえります, not かえます.",
        "くる becomes きます, not くります.",
        "Group a verb by its sound before る, not by how it looks in kana alone: おきる (-iru) is ru, かえる (-eru) happens to be u.",
      ],
      uni: "Quizzes ask for the ます and ません form of each verb in the vocabulary list. Learn them in pairs from day one.",
      checks: [
        {
          q: "Which group is のむ?",
          choices: ["u-verb", "ru-verb", "irregular"],
          answer: 0,
          why: "It doesn't end in る at all.",
        },
        {
          q: "かえる (to return) in the ます form:",
          choices: ["かえります", "かえます", "かえるます", "かえいます"],
          answer: 0,
          why: "かえる is a u-verb: る → り + ます.",
        },
        {
          q: "\"I don't watch TV.\"",
          jp: "テレビを ＿。",
          choices: ["みません", "みます", "みりません", "みないです"],
          answer: 0,
          why: "みる is a ru-verb: み + ません.",
        },
      ],
      games: ["verb-class", "masu-form"],
      ask: ["How do I know if a verb is a ru-verb or u-verb?", "Why is かえる a u-verb?"],
    },
    // ------------------------------------------------ grammar 2
    {
      id: "present",
      kind: "grammar",
      title: "Verb types and the present tense",
      name: "Grammar 2 · What ます means",
      genki: "Genki p. 88",
      teach:
        "The verbs in this lesson are action verbs. Their ます form covers two meanings that English splits:\n\n" +
        "**Habits**: what someone regularly does. よく テレビを みます. \"I often watch TV.\"\n\n" +
        "**Plans**: what someone will do. あした がっこうに いきます. \"I'll go to school tomorrow.\"\n\n" +
        "Context, usually a time word, tells you which. \"Am doing right now\" is a different form, taught in Lesson 7.",
      examples: [
        { jp: "まいばん おんがくを ききます。", en: "I listen to music every night. (habit)" },
        { jp: "こんばん えいがを みます。", en: "I'll watch a movie tonight. (plan)" },
        { jp: "ミンさんは あした きません。", en: "Min won't come tomorrow." },
      ],
      watch: ["Don't use the ます form for something happening right now (\"I'm eating\"). That's Lesson 7."],
      checks: [
        {
          q: "あした ほんを よみます。",
          choices: ["I'll read a book tomorrow.", "I read a book yesterday.", "I'm reading a book now.", "I read books every day."],
          answer: 0,
          why: "あした marks the future; ます covers it.",
        },
        {
          q: "まいにち おちゃを のみます。",
          choices: ["I drink tea every day.", "I'll drink tea once.", "I'm drinking tea.", "I drank tea."],
          answer: 0,
          why: "まいにち marks a habit.",
        },
      ],
      games: [],
      ask: ["How do I say 'I am eating now'?"],
    },
    // ------------------------------------------------ grammar 3
    {
      id: "particles",
      kind: "grammar",
      title: "を・で・に・へ",
      name: "Grammar 3 · Particles",
      genki: "Genki pp. 88–89",
      teach:
        "Particles go after a noun and show what it does in the sentence.\n\n" +
        "**を** (read \"o\"): the thing the action is done to. コーヒーを のみます.\n\n" +
        "**で**: where the action happens. としょかんで ほんを よみます.\n\n" +
        "**に**: (1) where you go, come or return to: がっこうに いきます; (2) the time something happens: くじに ねます.\n\n" +
        "**へ** (read \"e\"): where you're heading. It can replace に for going, coming and returning (うちへ かえります), but never for time.\n\n" +
        "**ごろ** after a time means \"about\": じゅういちじごろ ねます.",
      pattern: [
        ["〔thing〕を 〔verb〕", "do something to a thing"],
        ["〔place〕で 〔verb〕", "do something at a place"],
        ["〔place〕に／へ いく・くる・かえる", "go / come / return to a place"],
        ["〔time〕に 〔verb〕", "do something at a time"],
      ],
      examples: [
        { jp: "カフェで コーヒーを のみます。", en: "I drink coffee at a café." },
        { jp: "うちで ひるごはんを たべます。", en: "I eat lunch at home." },
        { jp: "どようびに がっこうへ いきます。", en: "I go to school on Saturday." },
        { jp: "しちじごろ おきます。", en: "I get up at about seven." },
        { jp: "にほんごを はなします。", en: "I speak Japanese." },
      ],
      watch: [
        "Place of action is で, not に: としょかんで べんきょうします.",
        "へ can't mark time: ×くじへ.",
        "を and へ are written with these kana but read \"o\" and \"e\".",
      ],
      uni: "に vs で is the classic Lesson 3 mistake and a favourite quiz item. Ask: is the verb going somewhere (に) or happening somewhere (で)?",
      checks: [
        {
          q: "I study at the library.",
          jp: "としょかん＿ べんきょうします。",
          choices: ["で", "に", "を", "へ"],
          answer: 0,
          why: "Where the action happens: で.",
        },
        {
          q: "I go home.",
          jp: "うち＿ かえります。",
          choices: ["に", "で", "を", "の"],
          answer: 0,
          why: "Where you return to: に (or へ).",
        },
        {
          q: "I read a magazine.",
          jp: "ざっし＿ よみます。",
          choices: ["を", "で", "に", "へ"],
          answer: 0,
          why: "The thing read: を.",
        },
      ],
      games: ["particles-u3"],
      ask: ["When do I use に vs で?", "Is there any difference between に and へ?"],
    },
    // ------------------------------------------------ grammar 4
    {
      id: "time-words",
      kind: "grammar",
      title: "Time references",
      name: "Grammar 4 · When に goes with a time",
      genki: "Genki p. 90",
      teach:
        "Some time words take に and some don't.\n\n" +
        "**Take に**: days of the week and times with numbers. どようびに, くじに, じゅうじはんに.\n\n" +
        "**No に**: words measured from today, regular intervals, and いつ. あした, きょう, こんばん, まいにち, まいばん, いつ.\n\n" +
        "**Either**: parts of the day and the weekend. あさ（に）, しゅうまつ（に）.",
      tables: [
        {
          caption: "に or not",
          rows: [
            ["Saturday", "どようびに"],
            ["at 9", "くじに"],
            ["at about 9", "くじごろ", "ごろ replaces に"],
            ["tomorrow", "あした", "no に"],
            ["today", "きょう", "no に"],
            ["tonight", "こんばん", "no に"],
            ["every day", "まいにち", "no に"],
            ["when?", "いつ", "no に"],
            ["in the morning", "あさ（に）", "optional"],
            ["on the weekend", "しゅうまつ（に）", "optional"],
          ],
        },
      ],
      examples: [
        { jp: "にちようびに えいがを みます。", en: "I'll see a movie on Sunday." },
        { jp: "あした テニスを します。", en: "I'll play tennis tomorrow." },
        { jp: "いつ うちに かえりますか。", en: "When will you go home?" },
      ],
      watch: ["×あしたに, ×まいにちに, ×いつに."],
      checks: [
        {
          q: "Does あした take に?",
          choices: ["No", "Yes", "Optional"],
          answer: 0,
          why: "It's measured from today: no に.",
        },
        {
          q: "\"on Sunday\"",
          choices: ["にちようびに", "にちようび", "にちようびで", "にちようびを"],
          answer: 0,
          why: "Days of the week take に.",
        },
      ],
      games: ["time-ni"],
      ask: ["Why doesn't あした take に?", "Can I say しゅうまつに?"],
    },
    // ------------------------------------------------ grammar 5
    {
      id: "invite",
      kind: "grammar",
      title: "〜ませんか",
      name: "Grammar 5 · Inviting",
      genki: "Genki pp. 90, 93 · Grammar 5, Expression Notes 4",
      teach:
        "To invite someone, ask a negative question with **ませんか**: えいがを みませんか. \"Won't you see a movie (with me)?\"\n\n" +
        "The positive question ますか is only a question, never an invitation: えいがを みますか = \"Do you watch movies?\"\n\n" +
        "**Accepting**: いいですね (Sounds good), or ええ、いいですよ.\n\n" +
        "**Declining**: Japanese avoids a flat いいえ. Say the problem is \"a little…\" and stop: どようびは ちょっと…. Then you can suggest something else: にちようびは どうですか.",
      pattern: [
        ["〔verb stem〕ませんか。", "Would you like to…? (invitation)"],
        ["〔time〕は ちょっと…", "…is a bit (inconvenient)."],
      ],
      examples: [
        { jp: "いっしょに ひるごはんを たべませんか。", en: "Would you like to have lunch together?", note: "いっしょに (together) is Lesson 5 vocabulary." },
        { jp: "いいですね。", en: "Sounds good." },
        { jp: "こんばんは ちょっと…。", en: "Tonight is a bit…" },
        { jp: "じゃあ、あしたは どうですか。", en: "Then how about tomorrow?" },
      ],
      watch: ["Inviting with ますか doesn't work: it's just a question.", "Turning someone down with いいえ sounds blunt."],
      checks: [
        {
          q: "Invite a friend to play tennis.",
          choices: ["テニスを しませんか。", "テニスを しますか。", "テニスを します。", "テニスを しません。"],
          answer: 0,
          why: "Invitation: ませんか.",
        },
        {
          q: "Turn down an invitation for Saturday, politely.",
          choices: ["どようびは ちょっと…。", "いいえ、しません。", "どようびは いいですね。", "どようびに します。"],
          answer: 0,
          why: "ちょっと… is the soft no.",
        },
      ],
      games: ["invite"],
      ask: ["How do I accept an invitation casually?", "Is ちょっと always a refusal?"],
    },
    // ------------------------------------------------ grammar 6
    {
      id: "frequency",
      kind: "grammar",
      title: "Frequency adverbs",
      name: "Grammar 6 · How often",
      genki: "Genki p. 91",
      teach:
        "With a positive verb: **まいにち** (every day), **よく** (often), **たいてい** (usually), **ときどき** (sometimes).\n\n" +
        "With a negative verb only: **あまり** (not often, not much) and **ぜんぜん** (never, not at all). The sentence must end in ません.\n\n" +
        "The adverb usually goes near the start, after the topic: わたしは よく えいがを みます.",
      tables: [
        {
          caption: "From often to never",
          rows: [
            ["every day", "まいにち 〜ます"],
            ["usually", "たいてい 〜ます"],
            ["often", "よく 〜ます"],
            ["sometimes", "ときどき 〜ます"],
            ["not often", "あまり 〜ません"],
            ["never", "ぜんぜん 〜ません"],
          ],
        },
      ],
      examples: [
        { jp: "ときどき カフェで べんきょうします。", en: "I sometimes study at a café." },
        { jp: "あまり テレビを みません。", en: "I don't watch TV much." },
        { jp: "ノアさんは ぜんぜん おさけを のみません。", en: "Noah never drinks alcohol." },
      ],
      watch: ["×ぜんぜん みます, ×あまり たべます. These need ません."],
      checks: [
        {
          q: "\"I don't read magazines much.\"",
          jp: "あまり ざっしを ＿。",
          choices: ["よみません", "よみます", "よむ", "よみませんか"],
          answer: 0,
          why: "あまり needs a negative verb.",
        },
        {
          q: "\"I often go to the library.\"",
          jp: "＿ としょかんに いきます。",
          choices: ["よく", "ぜんぜん", "あまり", "いつ"],
          answer: 0,
          why: "よく = often, with a positive verb.",
        },
      ],
      games: ["frequency"],
      ask: ["Can ときどき go at the end of a sentence?", "What's the difference between よく and たいてい?"],
    },
    // ------------------------------------------------ grammar 7–8
    {
      id: "order",
      kind: "grammar",
      title: "Word order · は",
      name: "Grammar 7–8 · Word order and the topic",
      genki: "Genki pp. 91–92",
      teach:
        "The verb comes last. Before it, the usual order is: topic, time, place, thing, verb.\n" +
        "わたしは きょう としょかんで にほんごを べんきょうします。\n\n" +
        "Or with frequency and a destination: topic, frequency, time, place, verb.\n" +
        "わたしは よく しちじごろ うちに かえります。\n\n" +
        "The other parts can move around; the verb stays at the end.\n\n" +
        "**は marks the topic, which doesn't have to be the subject.** A time word or an object can be the topic: しゅうまつは たいてい なにを しますか (\"As for weekends, what do you usually do?\"). Asking just ばんごはんは？ means \"What about dinner?\" and leaves the other person to finish the sentence.",
      pattern: [["〔topic〕は 〔time〕 〔place〕で 〔thing〕を 〔verb〕。", "the usual order"]],
      examples: [
        { jp: "わたしは あした うちで えいがを みます。", en: "I'll watch a movie at home tomorrow." },
        { jp: "しゅうまつは たいてい なにを しますか。", en: "What do you usually do on weekends?" },
        { jp: "A: ばんごはんは？ B: たべません。", en: "A: What about dinner? B: I won't eat." },
      ],
      watch: ["Don't put the verb anywhere but the end."],
      checks: [
        {
          q: "Which is in the usual order?",
          choices: [
            "わたしは きょう カフェで コーヒーを のみます。",
            "わたしは のみます きょう カフェで コーヒーを。",
            "コーヒーを のみます わたしは カフェで。",
            "のみます わたしは コーヒーを。",
          ],
          answer: 0,
          why: "Topic, time, place, thing, verb.",
        },
        {
          q: "きょうは なにを しますか。 The topic is:",
          choices: ["today", "you", "what", "nothing"],
          answer: 0,
          why: "は marks きょう as the topic.",
        },
      ],
      games: ["u3-builder"],
      ask: ["Can the object come before the time?", "Why is は used with きょう?"],
    },
    // ------------------------------------------------ expressions
    {
      id: "iku-kuru",
      kind: "expressions",
      title: "いく・くる・はい・ええ",
      name: "Going and coming, yes and yes",
      genki: "Genki p. 93 · Expression Notes 4",
      teach:
        "**いく and くる** depend on where the speaker is. くる is movement towards the speaker; いく is movement away. English \"I'm coming\" (to where you are) is いきます in Japanese, because the speaker moves away from where they are now.\n\n" +
        "**ちょっと** means \"a little\" (ちょっと まってください), and on its own it's the usual polite way to say no.\n\n" +
        "**はい and ええ** both mean yes. ええ is more relaxed; うん is casual. Only はい works for answering when your name is called (\"Here\").",
      examples: [
        { jp: "A: きませんか。 B: はい、いきます。", en: "A: Won't you come? B: Yes, I'll come." },
        { jp: "ちょっと まってください。", en: "Please wait a moment." },
      ],
      checks: [
        {
          q: "Your friend asks you to come to their party. You say \"I'll come\":",
          choices: ["いきます。", "きます。", "かえります。", "します。"],
          answer: 0,
          why: "You move away from where you are: いく.",
        },
      ],
      games: [],
      ask: ["When does Japanese use くる for 'come'?"],
    },
    // ------------------------------------------------ culture
    {
      id: "houses",
      kind: "culture",
      title: "にほんの いえ",
      name: "Japanese homes",
      genki: "Genki p. 101 · Culture Notes",
      teach:
        "**げんかん**: the entrance, a step below the rest of the house. Shoes come off here and point towards the door; slippers are often provided.\n\n" +
        "**たたみ** rooms have straw mats on the floor, and **ふすま** and **しょうじ** (sliding doors of paper and wood). Slippers come off before stepping onto tatami.\n\n" +
        "**The bath (おふろ)** is a separate room from the toilet. You wash and rinse outside the tub first, then soak; the bath water is shared by the family, so it stays clean.\n\n" +
        "**The toilet** often has its own toilet slippers, which stay in that room.",
      checks: [
        {
          q: "Where do you take your shoes off?",
          choices: ["げんかん", "たたみ", "おふろ", "トイレ"],
          answer: 0,
          why: "The げんかん is the entrance.",
        },
        {
          q: "In a Japanese bath you…",
          choices: ["wash before getting in the tub", "wash in the tub", "drain the tub after you", "use soap in the tub"],
          answer: 0,
          why: "The water is shared, so you get in clean.",
        },
      ],
      games: [],
      ask: ["Why are there toilet slippers?"],
    },
  ],
  dialogues: [
    {
      title: "Conversation 1: an invitation",
      setting: "Haruto and Lena talk after class on Thursday.",
      lines: [
        { who: "はると", jp: "レナさん、しゅうまつは たいてい なにを しますか。", en: "Lena, what do you usually do on weekends?" },
        { who: "レナ", jp: "そうですね。たいてい うちで べんきょうします。ときどき えいがを みます。", en: "Let me see. I usually study at home. Sometimes I watch movies." },
        { who: "はると", jp: "そうですか。じゃあ、どようびに えいがを みませんか。", en: "I see. Then would you like to see a movie on Saturday?" },
        { who: "レナ", jp: "どようびは ちょっと…。", en: "Saturday is a bit…" },
        { who: "はると", jp: "じゃあ、にちようびは どうですか。", en: "Then how about Sunday?" },
        { who: "レナ", jp: "いいですね。なんじに いきますか。", en: "Sounds good. What time shall we go?" },
        { who: "はると", jp: "いちじごろ どうですか。", en: "How about around one?" },
        { who: "レナ", jp: "ええ、いいですよ。", en: "Yes, that's fine." },
      ],
    },
    {
      title: "Conversation 2: going out",
      setting: "Sunday morning at Lena's homestay. Her host mother is in the kitchen.",
      lines: [
        { who: "おかあさん", jp: "おはよう、レナさん。はやいですね。", en: "Morning, Lena. You're up early." },
        { who: "レナ", jp: "おはようございます。きょうは はるとさんと えいがを みます。", en: "Good morning. I'm seeing a movie with Haruto today." },
        { who: "おかあさん", jp: "そうですか。なんじごろ かえりますか。", en: "I see. What time will you be back?" },
        { who: "レナ", jp: "ろくじごろ かえります。", en: "Around six." },
        { who: "おかあさん", jp: "ばんごはんは？", en: "And dinner?" },
        { who: "レナ", jp: "うちで たべます。", en: "I'll eat at home." },
        { who: "おかあさん", jp: "わかりました。いってらっしゃい。", en: "All right. See you later." },
        { who: "レナ", jp: "いってきます。", en: "Bye, see you later." },
      ],
    },
  ],
  together: ["invite"],
  test: [
    {
      q: "Which is a u-verb?",
      choices: ["かえる", "たべる", "おきる", "みる"],
      answer: 0,
      why: "かえる looks like a ru-verb but is a u-verb.",
    },
    {
      q: "のむ in the ます form:",
      choices: ["のみます", "のむます", "のます", "のめます"],
      answer: 0,
      why: "む → み + ます.",
    },
    {
      q: "くる in the negative:",
      choices: ["きません", "くりません", "くません", "こません"],
      answer: 0,
      why: "Irregular: きます / きません.",
    },
    {
      q: "I eat lunch at a café.",
      jp: "カフェ＿ ひるごはんを たべます。",
      choices: ["で", "に", "を", "へ"],
      answer: 0,
      why: "Place of action: で.",
    },
    {
      q: "I go to school at eight.",
      jp: "はちじ＿ がっこうに いきます。",
      choices: ["に", "で", "を", "へ"],
      answer: 0,
      why: "A clock time takes に.",
    },
    {
      q: "Which takes no に?",
      choices: ["まいばん", "どようび", "しちじ", "にちようび"],
      answer: 0,
      why: "Regular intervals take no に.",
    },
    {
      q: "Invite: \"Won't you drink coffee (with me)?\"",
      choices: ["コーヒーを のみませんか。", "コーヒーを のみますか。", "コーヒーを のみません。", "コーヒーを のみましょう か。"],
      answer: 0,
      why: "ませんか invites.",
    },
    {
      q: "\"I never watch TV.\"",
      choices: ["ぜんぜん テレビを みません。", "ぜんぜん テレビを みます。", "よく テレビを みません。", "ときどき テレビを みません。"],
      answer: 0,
      why: "ぜんぜん + ません.",
    },
    {
      q: "\"I'll come home at about seven.\"",
      choices: ["しちじごろ うちに かえります。", "しちじごろに うちで かえります。", "うちを しちじに かえります。", "しちじへ うちに かえります。"],
      answer: 0,
      why: "Time + ごろ, destination + に.",
    },
    {
      q: "しゅうまつは なにを しますか。 asks…",
      choices: ["what you do on weekends", "when your weekend is", "if you're free this weekend", "what you did last weekend"],
      answer: 0,
      why: "Weekend as the topic; ます for habits.",
    },
    {
      q: "Someone invites you, and you can't go. You say:",
      choices: ["ちょっと…。", "いいえ。", "いいですね。", "はい、そうです。"],
      answer: 0,
      why: "ちょっと… is the polite refusal.",
    },
    {
      q: "Your friend calls: \"Come over!\" You say \"I'm coming\":",
      choices: ["いきます。", "きます。", "かえります。", "ねます。"],
      answer: 0,
      why: "Going to where they are: いきます.",
    },
  ],
};

// ====================================================================
// Unit 4 · Genki Lesson 4 · はじめてのデート (The First Date)
// ====================================================================

export const L4: GenkiLesson = {
  id: "l4",
  num: 4,
  jp: "はじめてのデート",
  en: "The First Date",
  pages: "Genki I pp. 102–127",
  goals: [
    "Say what is where: あります and います",
    "Describe locations: in front of, behind, on, under, next to…",
    "Talk about the past: でした, ました, ませんでした",
    "Say how long you did something, and with whom",
    "Read and say dates, days and months",
  ],
  plan: [
    "1 · Days, dates and months; vocabulary",
    "2 · Grammar 1–2: あります / います, location words",
    "3 · Grammar 3–4: past of です, past of verbs",
    "4 · Grammar 5–8: も, durations, たくさん, と",
    "5 · Conversations, reading, unit test",
  ],
  practice: [
    { title: "Where things are", games: ["aru-iru", "location", "location-listen"] },
    { title: "The past", games: ["past-forms", "mo-particles", "goro-gurai"] },
    { title: "Reading", games: ["reading-u4"] },
    { title: "Role play", games: ["weekend"] },
    { title: "Dates and words", games: ["dates", "vocab-l4"] },
  ],
  vocab: [
    {
      title: "Activities",
      words: [
        { jp: "アルバイト", en: "part-time job (バイト for short)" },
        { jp: "かいもの", kanji: "買い物", en: "shopping" },
        { jp: "クラス", en: "class" },
        { jp: "ゲーム", en: "game" },
      ],
    },
    {
      title: "People and things",
      words: [
        { jp: "あなた", en: "you" },
        { jp: "いす", en: "chair" },
        { jp: "いぬ", kanji: "犬", en: "dog" },
        { jp: "こども", kanji: "子供", en: "child" },
        { jp: "ごはん", kanji: "ご飯", en: "rice; meal" },
        { jp: "しゃしん", kanji: "写真", en: "photo", star: true },
        { jp: "つくえ", kanji: "机", en: "desk" },
        { jp: "ねこ", kanji: "猫", en: "cat" },
        { jp: "パン", en: "bread" },
        { jp: "ひと", kanji: "人", en: "person", star: true },
        { jp: "はな", kanji: "花", en: "flower" },
        { jp: "レポート", en: "(term) paper" },
      ],
    },
    {
      title: "Places",
      words: [
        { jp: "おてら", kanji: "お寺", en: "temple", star: true },
        { jp: "こうえん", kanji: "公園", en: "park", star: true },
        { jp: "スーパー", en: "supermarket" },
        { jp: "デパート", en: "department store" },
        { jp: "バスてい", kanji: "バス停", en: "bus stop" },
        { jp: "びょういん", kanji: "病院", en: "hospital" },
        { jp: "ホテル", en: "hotel", star: true },
        { jp: "ほんや", kanji: "本屋", en: "bookstore", star: true },
        { jp: "まち", kanji: "町", en: "town; city" },
        { jp: "レストラン", en: "restaurant" },
      ],
    },
    {
      title: "Time",
      words: [
        { jp: "きのう", kanji: "昨日", en: "yesterday" },
        { jp: "〜じかん", kanji: "〜時間", en: "… hours", star: true },
        { jp: "いちじかん", kanji: "一時間", en: "one hour" },
        { jp: "せんしゅう", kanji: "先週", en: "last week" },
        { jp: "とき", kanji: "時", en: "when…; at the time of… (〜の)" },
        { jp: "げつようび", kanji: "月曜日", en: "Monday" },
        { jp: "かようび", kanji: "火曜日", en: "Tuesday" },
        { jp: "すいようび", kanji: "水曜日", en: "Wednesday" },
        { jp: "もくようび", kanji: "木曜日", en: "Thursday" },
        { jp: "きんようび", kanji: "金曜日", en: "Friday" },
      ],
    },
    {
      title: "U-verbs",
      words: [
        { jp: "あう", kanji: "会う", en: "to meet, see (a person) (に)" },
        { jp: "ある", en: "there is (a thing)", star: true },
        { jp: "かう", kanji: "買う", en: "to buy (を)" },
        { jp: "かく", kanji: "書く", en: "to write (を)" },
        { jp: "とる", kanji: "撮る", en: "to take (a photo) (を)", star: true },
        { jp: "まつ", kanji: "待つ", en: "to wait (を)", star: true },
        { jp: "わかる", en: "to understand (が)", star: true },
      ],
    },
    {
      title: "Ru-verb",
      words: [{ jp: "いる", en: "(a person or animal) is, stays", star: true }],
    },
    {
      title: "Location words",
      words: [
        { jp: "みぎ", kanji: "右", en: "right" },
        { jp: "ひだり", kanji: "左", en: "left" },
        { jp: "まえ", kanji: "前", en: "front", star: true },
        { jp: "うしろ", kanji: "後ろ", en: "back, behind" },
        { jp: "なか", kanji: "中", en: "inside" },
        { jp: "うえ", kanji: "上", en: "on, above" },
        { jp: "した", kanji: "下", en: "under, below" },
        { jp: "ちかく", kanji: "近く", en: "near, nearby" },
        { jp: "となり", kanji: "隣", en: "next to" },
        { jp: "あいだ", kanji: "間", en: "between (AとBの)" },
      ],
    },
    {
      title: "Other words",
      words: [
        { jp: "〜ぐらい", en: "about (an amount)" },
        { jp: "ごめんなさい", en: "I'm sorry.", star: true },
        { jp: "それから", en: "and then" },
        { jp: "だから", en: "so, therefore", star: true },
        { jp: "たくさん", en: "many, a lot", star: true },
        { jp: "〜と", en: "together with (a person); and", star: true },
        { jp: "どうして", en: "why", star: true },
        { jp: "ひとりで", kanji: "一人で", en: "alone", star: true },
        { jp: "もしもし", en: "Hello? (on the phone)", star: true },
      ],
    },
  ],
  steps: [
    // ------------------------------------------------ warm-up: calendar
    {
      id: "calendar",
      kind: "warmup",
      optional: true,
      title: "ひ・しゅう・つき・とし",
      name: "Days, weeks, months, years",
      genki: "Genki p. 127 · Useful Expressions",
      teach:
        "**Days of the week** all end in ようび: にちようび (Sun), げつようび (Mon), かようび (Tue), すいようび (Wed), もくようび (Thu), きんようび (Fri), どようび (Sat).\n\n" +
        "**Months** are number + がつ. Watch 4, 7 and 9: しがつ, しちがつ, くがつ.\n\n" +
        "**Dates** 1–10 have their own words, and so do the 14th, 20th and 24th. The rest are number + にち.\n\n" +
        "**Relative time** follows a pattern: last / this / next week is せんしゅう / こんしゅう / らいしゅう, month せんげつ / こんげつ / らいげつ, year きょねん / ことし / らいねん.",
      tables: [
        {
          caption: "Dates",
          rows: [
            ["1st", "ついたち"],
            ["2nd", "ふつか"],
            ["3rd", "みっか"],
            ["4th", "よっか"],
            ["5th", "いつか"],
            ["6th", "むいか"],
            ["7th", "なのか"],
            ["8th", "ようか"],
            ["9th", "ここのか"],
            ["10th", "とおか"],
            ["11th", "じゅういちにち"],
            ["14th", "じゅうよっか", "irregular"],
            ["17th", "じゅうしちにち"],
            ["19th", "じゅうくにち"],
            ["20th", "はつか", "irregular"],
            ["24th", "にじゅうよっか", "irregular"],
          ],
        },
        {
          caption: "Months",
          rows: [
            ["January", "いちがつ"],
            ["February", "にがつ"],
            ["March", "さんがつ"],
            ["April", "しがつ", "し, not よん"],
            ["May", "ごがつ"],
            ["June", "ろくがつ"],
            ["July", "しちがつ", "しち, not なな"],
            ["August", "はちがつ"],
            ["September", "くがつ", "く, not きゅう"],
            ["October", "じゅうがつ"],
            ["November", "じゅういちがつ"],
            ["December", "じゅうにがつ"],
          ],
        },
        {
          caption: "Relative time",
          rows: [
            ["2 days ago / yesterday", "おととい / きのう"],
            ["today", "きょう"],
            ["tomorrow / in 2 days", "あした / あさって"],
            ["last / this / next week", "せんしゅう / こんしゅう / らいしゅう"],
            ["last / this / next month", "せんげつ / こんげつ / らいげつ"],
            ["last / this / next year", "きょねん / ことし / らいねん"],
          ],
        },
      ],
      examples: [
        { jp: "たんじょうびは しがつ ふつかです。", en: "My birthday is April 2nd.", note: "たんじょうび (birthday) is Lesson 5 vocabulary." },
        { jp: "きょうは もくようびです。", en: "Today is Thursday." },
      ],
      watch: ["14th and 24th use よっか, 20th is はつか.", "April, July, September: しがつ, しちがつ, くがつ."],
      checks: [
        {
          q: "The 8th of the month:",
          choices: ["ようか", "はちにち", "やっか", "はっか"],
          answer: 0,
          why: "Dates 1–10 have their own words.",
        },
        {
          q: "September:",
          choices: ["くがつ", "きゅうがつ", "くつき", "きゅうつき"],
          answer: 0,
          why: "9 is く in month names.",
        },
        {
          q: "Wednesday:",
          choices: ["すいようび", "もくようび", "かようび", "きんようび"],
          answer: 0,
          why: "すい = water (水).",
        },
      ],
      games: ["dates"],
      ask: ["Why do dates 1–10 have special readings?", "How do I say 'next Monday'?"],
    },
    // ------------------------------------------------ grammar 1
    {
      id: "aru-iru",
      kind: "grammar",
      title: "X が あります／います",
      name: "Grammar 1 · There is…",
      genki: "Genki pp. 107–108",
      teach:
        "To say \"there is X\", use **あります** for things and **います** for people and animals.\n\n" +
        "The thing takes **が**, and the place takes **に**. The place usually comes first:\n" +
        "あそこに ぎんこうが あります。 There's a bank over there.\n" +
        "こうえんに こどもが います。 There are children in the park.\n\n" +
        "**あります also means \"have\"**: じかんが ありますか (\"Do you have time?\"). **います** for people you have: ともだちが います.\n\n" +
        "**あります for events**: きんようびに テストが あります (\"There's a test on Friday\"). For where an event takes place, use で: まちで おまつりが あります.",
      pattern: [
        ["〔place〕に 〔thing〕が あります。", "There is a thing at the place."],
        ["〔place〕に 〔person / animal〕が います。", "There is someone at the place."],
      ],
      examples: [
        { jp: "つくえの うえに ほんが あります。", en: "There's a book on the desk." },
        { jp: "あそこに ねこが います。", en: "There's a cat over there." },
        { jp: "あしたは にほんごの クラスが ありません。", en: "There's no Japanese class tomorrow." },
        { jp: "にほんじんの ともだちが います。", en: "I have a Japanese friend." },
      ],
      watch: [
        "Animals and people: います, even a cat or a fish. Plants and objects: あります.",
        "The place takes に here, not で.",
        "がくせいが いません (\"there's no student\") is not がくせいじゃないです (\"isn't a student\").",
      ],
      uni: "Quizzes mix あります / います with place に vs で. Existence takes に; actions take で.",
      checks: [
        {
          q: "There's a dog in the park.",
          jp: "こうえんに いぬが ＿。",
          choices: ["います", "あります", "です", "します"],
          answer: 0,
          why: "Animals: います.",
        },
        {
          q: "There's a bookstore over there.",
          jp: "あそこ＿ ほんやが あります。",
          choices: ["に", "で", "を", "は"],
          answer: 0,
          why: "Where something is: に.",
        },
        {
          q: "\"Do you have time?\"",
          choices: ["じかんが ありますか。", "じかんが いますか。", "じかんですか。", "じかんを ありますか。"],
          answer: 0,
          why: "Having something: が あります.",
        },
      ],
      games: ["aru-iru"],
      ask: ["Why が and not は here?", "Do plants take あります or います?"],
    },
    // ------------------------------------------------ grammar 2
    {
      id: "location",
      kind: "grammar",
      title: "X は Y の まえです",
      name: "Grammar 2 · Where things are",
      genki: "Genki pp. 108–109",
      teach:
        "In Lesson 2 you said where something is with あそこです. Now you can say where it is relative to something else: **X は Y の 〔location〕です**.\n\n" +
        "ぎんこうは としょかんの となりです。 The bank is next to the library.\n\n" +
        "**Between**: X は Y と Z の あいだです.\n\n" +
        "To do something at that place, use **で**: えきの まえで まちます (\"I'll wait in front of the station\").",
      tables: [
        {
          caption: "Location words",
          rows: [
            ["right", "みぎ"],
            ["left", "ひだり"],
            ["in front of", "まえ"],
            ["behind", "うしろ"],
            ["inside", "なか"],
            ["on, above", "うえ"],
            ["under, below", "した"],
            ["near", "ちかく"],
            ["next to", "となり"],
            ["between", "あいだ", "AとBの あいだ"],
          ],
        },
      ],
      examples: [
        { jp: "ねこは つくえの したです。", en: "The cat is under the desk." },
        { jp: "かばんは いすの うえに あります。", en: "The bag is on the chair." },
        { jp: "レストランは ホテルと ぎんこうの あいだです。", en: "The restaurant is between the hotel and the bank." },
        { jp: "こうえんの まえで まちました。", en: "I waited in front of the park.", note: "まちました is past tense: Grammar 4." },
      ],
      watch: [
        "Don't forget の: としょかんの となり, not ×としょかん となり.",
        "となり is for two similar things side by side (buildings, people). For a bag by a desk, Japanese uses よこ (beside).",
      ],
      checks: [
        {
          q: "\"The umbrella is under the chair.\"",
          choices: ["かさは いすの したです。", "かさは いす したです。", "かさは したの いすです。", "いすは かさの したです。"],
          answer: 0,
          why: "X は Y の した.",
        },
        {
          q: "\"I'll wait in front of the bookstore.\"",
          jp: "ほんやの まえ＿ まちます。",
          choices: ["で", "に", "を", "が"],
          answer: 0,
          why: "An action at a place: で.",
        },
      ],
      games: ["location", "location-listen"],
      ask: ["What's the difference between となり and よこ?", "How do I say 'across from'?"],
    },
    // ------------------------------------------------ grammar 3
    {
      id: "past-desu",
      kind: "grammar",
      title: "でした・じゃなかったです",
      name: "Grammar 3 · Past tense of です",
      genki: "Genki p. 110",
      teach:
        "The past of です is **でした**. The past of じゃないです is **じゃなかったです**.\n\n" +
        "As with the present, there are more formal versions: じゃありませんでした, and in writing ではありませんでした.",
      tables: [
        {
          caption: "です",
          rows: [
            ["is", "です"],
            ["isn't", "じゃないです"],
            ["was", "でした"],
            ["wasn't", "じゃなかったです", "also じゃありませんでした"],
          ],
        },
      ],
      examples: [
        { jp: "やまもとせんせいは さくらだいがくの がくせいでした。", en: "Professor Yamamoto was a student at Sakura University." },
        { jp: "きのうは どようびでした。", en: "Yesterday was Saturday." },
        { jp: "あれは にほんの えいがじゃなかったです。", en: "That wasn't a Japanese movie." },
      ],
      watch: ["Only for nouns (and words that work like them). Adjectives get their own past in Lesson 5."],
      checks: [
        {
          q: "\"It was Sunday.\"",
          choices: ["にちようびでした。", "にちようびです。", "にちようびじゃなかったです。", "にちようびました。"],
          answer: 0,
          why: "Past of です: でした.",
        },
        {
          q: "\"He wasn't a student.\"",
          choices: ["がくせいじゃなかったです。", "がくせいじゃないでした。", "がくせいでしたじゃない。", "がくせいませんでした。"],
          answer: 0,
          why: "じゃなかったです.",
        },
      ],
      games: ["past-forms"],
      ask: ["Which past negative should I use in writing?"],
    },
    // ------------------------------------------------ grammar 4
    {
      id: "past-verbs",
      kind: "grammar",
      title: "〜ました・〜ませんでした",
      name: "Grammar 4 · Past tense of verbs",
      genki: "Genki p. 110",
      teach:
        "Replace ます with **ました** for the past, and ません with **ませんでした** for the past negative. The three verb groups work the same as in Lesson 3: たべます → たべました, いきます → いきました, します → しました.",
      tables: [
        {
          caption: "Verbs",
          rows: [
            ["do / will do", "〜ます"],
            ["don't / won't", "〜ません"],
            ["did", "〜ました"],
            ["didn't", "〜ませんでした"],
          ],
        },
      ],
      examples: [
        { jp: "きのう としょかんで べんきょうしました。", en: "I studied at the library yesterday." },
        { jp: "あさごはんを たべませんでした。", en: "I didn't eat breakfast." },
        { jp: "ミンさんは くじごろ うちに かえりました。", en: "Min went home at about nine." },
        { jp: "しゃしんを たくさん とりました。", en: "I took a lot of photos." },
      ],
      watch: ["×たべませんでしたです. ませんでした already ends the sentence."],
      checks: [
        {
          q: "\"I bought shoes.\"",
          jp: "くつを ＿。",
          choices: ["かいました", "かいます", "かいませんでした", "かうました"],
          answer: 0,
          why: "Past of かいます.",
        },
        {
          q: "\"I didn't go.\"",
          choices: ["いきませんでした。", "いきました。", "いきません。", "いかないでした。"],
          answer: 0,
          why: "ません → ませんでした.",
        },
      ],
      games: ["past-forms"],
      ask: ["Is there a casual past form?"],
    },
    // ------------------------------------------------ grammar 5
    {
      id: "mo2",
      kind: "grammar",
      title: "も",
      name: "Grammar 5 · も with other particles",
      genki: "Genki p. 111",
      teach:
        "In Lesson 2, も replaced は. It also replaces **が** and **を**:\n" +
        "パンを かいました。ノートも かいました。 I bought bread. I bought a notebook too.\n\n" +
        "With other particles, も goes **after** them instead of replacing them: **にも**, **でも**.\n" +
        "きょうとに いきました。おおさかにも いきました。 I went to Kyoto. I went to Osaka too.\n" +
        "うちで よみました。カフェでも よみました。 I read at home. I read at a café too.",
      tables: [
        {
          caption: "も",
          rows: [
            ["は, が, を", "→ も", "replaced"],
            ["に", "→ にも", "kept"],
            ["で", "→ でも", "kept"],
          ],
        },
      ],
      examples: [
        { jp: "レナさんは こうえんに いきました。ミンさんも いきました。", en: "Lena went to the park. Min went too." },
        { jp: "どようびに がっこうに きました。にちようびにも きました。", en: "I came to school on Saturday. I came on Sunday too." },
      ],
      watch: ["×をも, ×がも. Those particles disappear.", "×に も → write it together: にも."],
      checks: [
        {
          q: "I ate bread. I ate rice too.",
          jp: "パンを たべました。ごはん＿ たべました。",
          choices: ["も", "をも", "にも", "でも"],
          answer: 0,
          why: "を is replaced by も.",
        },
        {
          q: "I went to the park. I went to the temple too.",
          jp: "こうえんに いきました。おてら＿ いきました。",
          choices: ["にも", "も", "をも", "でも"],
          answer: 0,
          why: "に stays: にも.",
        },
      ],
      games: ["mo-particles"],
      ask: ["Why does に stay but を disappears?"],
    },
    // ------------------------------------------------ grammar 6
    {
      id: "duration",
      kind: "grammar",
      title: "いちじかん",
      name: "Grammar 6 · How long",
      genki: "Genki p. 112",
      teach:
        "A length of time is a number + **じかん** (hours), with no particle after it: いちじかん まちました (\"I waited for an hour\").\n\n" +
        "Add **ぐらい** for \"about\": さんじかんぐらい べんきょうしました. Add **はん** for \"and a half\": にじかんはん. With both, ぐらい goes last: いちじかんはんぐらい.\n\n" +
        "**ごろ vs ぐらい**: ごろ is about a point in time (くじごろ, around nine o'clock). ぐらい is about an amount (くじかんぐらい, around nine hours).",
      tables: [
        {
          caption: "Hours",
          rows: [
            ["1 hour", "いちじかん"],
            ["2 hours", "にじかん"],
            ["4 hours", "よじかん", "よ, as in よじ"],
            ["7 hours", "しちじかん / ななじかん"],
            ["9 hours", "くじかん"],
            ["1.5 hours", "いちじかんはん"],
            ["about 3 hours", "さんじかんぐらい"],
          ],
        },
      ],
      examples: [
        { jp: "きのう にほんごを さんじかんぐらい べんきょうしました。", en: "I studied Japanese for about three hours yesterday." },
        { jp: "えきで いちじかん まちました。", en: "I waited at the station for an hour." },
        { jp: "しちじごろ おきました。", en: "I got up at around seven." },
      ],
      watch: ["No particle after a duration: ×いちじかんに まちました.", "ごろ = around a time; ぐらい = about an amount."],
      checks: [
        {
          q: "\"I slept about eight hours.\"",
          jp: "はちじかん＿ ねました。",
          choices: ["ぐらい", "ごろ", "に", "で"],
          answer: 0,
          why: "An amount of time: ぐらい.",
        },
        {
          q: "\"I got up at about six.\"",
          jp: "ろくじ＿ おきました。",
          choices: ["ごろ", "ぐらい", "じかん", "で"],
          answer: 0,
          why: "A point in time: ごろ.",
        },
      ],
      games: ["goro-gurai"],
      ask: ["Can I use ぐらい for a clock time?", "How do I say '30 minutes'?"],
    },
    // ------------------------------------------------ grammar 7–8
    {
      id: "takusan-to",
      kind: "grammar",
      title: "たくさん・と",
      name: "Grammar 7–8 · A lot, and, with",
      genki: "Genki pp. 112–113",
      teach:
        "**たくさん** (a lot) can go before the noun or after its particle:\n" +
        "たくさん しゃしんを とりました。 / しゃしんを たくさん とりました。\n\n" +
        "**と** has two jobs:\n" +
        "(1) \"and\" between nouns: にほんごと えいごを はなします.\n" +
        "(2) \"with\" a person: ともだちと えいがを みました.\n\n" +
        "と joins nouns only; joining verbs or sentences is Lesson 6. \"With\" a tool (with chopsticks) is a different particle, in Lesson 10. To do something alone: **ひとりで**.",
      examples: [
        { jp: "こうえんに こどもが たくさん います。", en: "There are lots of children in the park." },
        { jp: "パンと コーヒーを かいました。", en: "I bought bread and coffee." },
        { jp: "はるとさんと きょうとに いきました。", en: "I went to Kyoto with Haruto." },
        { jp: "ひとりで ばんごはんを たべました。", en: "I ate dinner alone." },
      ],
      watch: ["Don't use と to join sentences (\"I ate and slept\")."],
      checks: [
        {
          q: "\"I went shopping with my friend.\"",
          jp: "ともだち＿ かいものに いきました。",
          choices: ["と", "で", "を", "も"],
          answer: 0,
          why: "With a person: と.",
        },
        {
          q: "\"I drank a lot of coffee.\"",
          choices: ["コーヒーを たくさん のみました。", "コーヒーが たくさん のみました。", "たくさんを コーヒー のみました。", "コーヒー たくさんで のみました。"],
          answer: 0,
          why: "たくさん after the particle, before the verb.",
        },
      ],
      games: ["weekend"],
      ask: ["How do I say 'and' between two verbs?", "Can たくさん go after the verb?"],
    },
    // ------------------------------------------------ expressions + culture
    {
      id: "notes-u4",
      kind: "culture",
      title: "えっ・あっ・まえ",
      name: "Small words and holidays",
      genki: "Genki pp. 113–114 · Expression Notes 5, Culture Notes",
      teach:
        "**X の まえ** often means across the street from X, not only directly in front of it. **X の うしろ** can also mean somewhere behind X, out of sight from the street.\n\n" +
        "**えっ** is surprise or disbelief (\"What?!\"). **あっ** is suddenly noticing or remembering (\"Oh!\"). The small っ makes them short and sharp.\n\n" +
        "**あなた** again: in a question like \"What will you do this weekend?\" Japanese just leaves \"you\" out: こんしゅうの しゅうまつ、なにを しますか.\n\n" +
        "**Holidays.** Japan has sixteen national holidays. The busiest are New Year (around January 1–3), **Golden Week** (late April to May 5, several holidays in a row), and the summer **おぼん** period in mid-August (not an official holiday, but many people travel). Some holidays are fixed to a date, others to a Monday, which makes long weekends.",
      checks: [
        {
          q: "You just remembered you left your umbrella. You say:",
          choices: ["あっ。", "えっ。", "いいえ。", "どうも。"],
          answer: 0,
          why: "あっ = sudden noticing.",
        },
        {
          q: "Golden Week is in…",
          choices: ["late April to early May", "August", "late December", "March"],
          answer: 0,
          why: "Several holidays from late April to May 5.",
        },
      ],
      games: [],
      ask: ["What other holidays are there in Japan?"],
    },
  ],
  dialogues: [
    {
      title: "Conversation 1: where is it?",
      setting: "On Sunday Lena is looking for the cinema in town. She asks someone on the street.",
      lines: [
        { who: "レナ", jp: "すみません。このちかくに えいがかんが ありますか。", en: "Excuse me. Is there a cinema (えいがかん) near here?" },
        { who: "おとこのひと", jp: "えいがかんですか。ええ、あります。あの ホテルの となりです。", en: "A cinema? Yes. It's next to that hotel." },
        { who: "レナ", jp: "あの ホテルですか。", en: "That hotel?" },
        { who: "おとこのひと", jp: "ええ。ホテルと ぎんこうの あいだです。", en: "Yes. Between the hotel and the bank." },
        { who: "レナ", jp: "ありがとうございました。", en: "Thank you very much." },
      ],
    },
    {
      title: "Conversation 2: about the weekend",
      setting: "Monday at school. Min asks Lena about her Sunday.",
      lines: [
        { who: "ミン", jp: "レナさん、きのうは なにを しましたか。", en: "Lena, what did you do yesterday?" },
        { who: "レナ", jp: "えいがかんで はるとさんを まちました。でも、はるとさんは きませんでした。", en: "I waited for Haruto at the cinema. But he didn't come." },
        { who: "ミン", jp: "えっ、どうしてですか。", en: "What? Why?" },
        { who: "レナ", jp: "わかりません。えいがかんの まえで いちじかん まちました。", en: "I don't know. I waited an hour in front of the cinema." },
        { who: "ミン", jp: "それから？", en: "And then?" },
        { who: "レナ", jp: "ひとりで ほんやに いきました。それから、こうえんで しゃしんを たくさん とりました。", en: "I went to a bookstore alone. Then I took lots of photos in the park." },
        { who: "はると", jp: "あっ、レナさん！ ごめんなさい！ きのう、えきの まえで まちました。", en: "Oh, Lena! I'm so sorry! Yesterday I waited in front of the station." },
        { who: "レナ", jp: "えっ、えきの まえ？", en: "What, in front of the station?" },
      ],
    },
  ],
  together: ["weekend"],
  test: [
    {
      q: "There's a cat under the chair.",
      jp: "いすの したに ねこが ＿。",
      choices: ["います", "あります", "です", "でした"],
      answer: 0,
      why: "Animals: います.",
    },
    {
      q: "There's a bus stop in front of the hospital.",
      jp: "びょういんの まえ＿ バスていが あります。",
      choices: ["に", "で", "を", "も"],
      answer: 0,
      why: "Where something is: に.",
    },
    {
      q: "\"The bank is between the supermarket and the post office.\"",
      choices: [
        "ぎんこうは スーパーと ゆうびんきょくの あいだです。",
        "ぎんこうは スーパーの ゆうびんきょくの あいだです。",
        "ぎんこうは あいだの スーパーと ゆうびんきょくです。",
        "スーパーと ゆうびんきょくは ぎんこうの あいだです。",
      ],
      answer: 0,
      why: "X は A と B の あいだ.",
    },
    {
      q: "\"Yesterday was Friday.\"",
      choices: ["きのうは きんようびでした。", "きのうは きんようびです。", "きのうは きんようびました。", "きのうは きんようびじゃなかったです。"],
      answer: 0,
      why: "でした.",
    },
    {
      q: "\"I didn't write the paper.\"",
      choices: ["レポートを かきませんでした。", "レポートを かきました。", "レポートを かきません でしたです。", "レポートを かかないでした。"],
      answer: 0,
      why: "ませんでした.",
    },
    {
      q: "I met Min on Saturday. I met her on Sunday too.",
      jp: "にちようび＿ ミンさんに あいました。",
      choices: ["にも", "も", "でも", "をも"],
      answer: 0,
      why: "に stays: にも.",
    },
    {
      q: "\"I waited about two hours.\"",
      choices: ["にじかんぐらい まちました。", "にじごろ まちました。", "にじかんに まちました。", "にじかんぐらいに まちました。"],
      answer: 0,
      why: "Amount: ぐらい, no particle.",
    },
    {
      q: "\"I went to the department store with Noah.\"",
      choices: ["ノアさんと デパートに いきました。", "ノアさんで デパートに いきました。", "ノアさんを デパートに いきました。", "ノアさんに デパートで いきました。"],
      answer: 0,
      why: "With a person: と.",
    },
    {
      q: "The 20th:",
      choices: ["はつか", "にじゅうにち", "にじゅっか", "はたち"],
      answer: 0,
      why: "The 20th is はつか (はたち is 20 years old).",
    },
    {
      q: "July:",
      choices: ["しちがつ", "ななつき", "なながつ", "しちつき"],
      answer: 0,
      why: "しちがつ.",
    },
    {
      q: "\"Do you have a dog?\"",
      choices: ["いぬが いますか。", "いぬが ありますか。", "いぬですか。", "いぬを いますか。"],
      answer: 0,
      why: "Animals you have: います.",
    },
    {
      q: "You hear something hard to believe. You say:",
      choices: ["えっ？", "あっ。", "もしもし。", "どうぞ。"],
      answer: 0,
      why: "えっ = disbelief.",
    },
  ],
};
