// Everything the resident's phone says, in the six languages Sahayak speaks.
// Translations are plain, short and spoken-style; have a native speaker review before real use.

export type Lang = 'or' | 'hi' | 'bn' | 'te' | 'ta' | 'en'
export const LANGS: Lang[] = ['or', 'hi', 'bn', 'te', 'ta', 'en']
export const LANG_NAME: Record<Lang, string> = { or: 'ଓଡ଼ିଆ', hi: 'हिन्दी', bn: 'বাংলা', te: 'తెలుగు', ta: 'தமிழ்', en: 'English' }
export const LANG_EN: Record<Lang, string> = { or: 'Odia', hi: 'Hindi', bn: 'Bengali', te: 'Telugu', ta: 'Tamil', en: 'English' }

export const HOUSEHOLD = ['elderly', 'children', 'disabled', 'pregnant', 'livestock', 'boat'] as const
export type Need = (typeof HOUSEHOLD)[number]
/** People who should not be left to walk: offer a vehicle first. */
export const NEEDS_VEHICLE: Need[] = ['elderly', 'disabled', 'pregnant']

type Strings = Record<string, string>

const en: Strings = {
  chooseLang: 'Choose your language', whereAreYou: 'Where are you?', useGps: 'Use my location', locating: 'Finding you…',
  gpsFailed: 'Could not find your location. Choose your village below.', pickVillage: 'Or choose your village',
  whoWithYou: 'Who is with you?', whoHint: 'So we can give the right advice', next: 'Next', start: 'Start',
  elderly: 'Elderly person', children: 'Small children', disabled: "Someone who can't walk far", pregnant: 'Pregnant woman',
  livestock: 'Cattle or goats', boat: 'Fishing boat',
  noAlert: 'No official alert for {place} right now.', alertWillCome: 'If the district issues a warning, this phone will ring and read it to you.',
  getReady: 'Get ready', actNow: 'Go to the shelter now', leaveBy: 'Leave before {time}', walkMin: '{n} min walk',
  listen: 'Listen', guideMe: 'Guide me there', needHelp: 'I need help', sendVehicle: 'Send a vehicle for me',
  vehicleSent: 'Request sent. The control room will send a vehicle.', reached: 'I reached the shelter', markedSafe: 'You are marked safe',
  tellFamily: 'Tell my family', talk: 'Talk to Sahayak', reportWater: 'Report water', settings: 'Change language or details',
  incoming: 'Incoming alert call', cycloneWarning: 'cyclone warning', officialAlert: 'Official alert', seeEnglish: 'See in English', showOriginal: 'Show original',
  toShelter: 'To {name}', head: 'Head {dir}', thenIn: 'In {d}', turnLeft: 'turn left', turnRight: 'turn right', slightLeft: 'keep left',
  slightRight: 'keep right', straight: 'go straight', uturn: 'turn around', arrive: 'You have reached {name}. Stay inside until the all-clear.',
  arriveSoon: 'The shelter is {d} ahead', water: 'Water reported {d} ahead. Keep to higher ground.', waterForecast: 'Flooding is expected {d} ahead.',
  simulate: 'Show me the walk', pause: 'Pause', routeDry: 'The route stays dry', routeWet: 'Water on the way: follow the voice',
  safeMsg: 'I have reached {shelter} safely. (Pralay Kavach)', metres: '{n} metres', km: '{n} km', back: 'Back', openMaps: 'Open in Google Maps',
  tip_general: 'Carry ID, medicines, water, a torch and your phone charger.',
  tip_elderly: 'Leave early with the elderly. Ask for a vehicle if walking is hard.',
  tip_children: 'Carry water, dry food and a change of clothes for the children.',
  tip_disabled: 'Ask for a vehicle now. Do not wait until the wind starts.',
  tip_pregnant: 'Carry her medical papers and tell the shelter staff when you arrive.',
  tip_livestock: 'Untie your animals and move them to high ground. Do not stay back for them.',
  tip_boat: 'Pull the boat ashore and tie it down. Do not go out to sea.',
  dirs: 'north|north-east|east|south-east|south|south-west|west|north-west',
}

const hi: Strings = {
  chooseLang: 'अपनी भाषा चुनें', whereAreYou: 'आप कहाँ हैं?', useGps: 'मेरी जगह पता करें', locating: 'आपकी जगह ढूँढ रहे हैं…',
  gpsFailed: 'आपकी जगह नहीं मिली। नीचे अपना गाँव चुनें।', pickVillage: 'या अपना गाँव चुनें',
  whoWithYou: 'आपके साथ कौन है?', whoHint: 'ताकि हम सही सलाह दे सकें', next: 'आगे', start: 'शुरू करें',
  elderly: 'बुज़ुर्ग', children: 'छोटे बच्चे', disabled: 'जो ज़्यादा चल नहीं सकते', pregnant: 'गर्भवती महिला', livestock: 'गाय या बकरियाँ', boat: 'मछली पकड़ने की नाव',
  noAlert: '{place} के लिए अभी कोई सरकारी चेतावनी नहीं है।', alertWillCome: 'ज़िले से चेतावनी आने पर यह फ़ोन बजेगा और उसे पढ़कर सुनाएगा।',
  getReady: 'तैयारी करें', actNow: 'अभी आश्रय स्थल जाएँ', leaveBy: '{time} से पहले निकलें', walkMin: '{n} मिनट पैदल',
  listen: 'सुनें', guideMe: 'मुझे रास्ता दिखाएँ', needHelp: 'मुझे मदद चाहिए', sendVehicle: 'मेरे लिए गाड़ी भेजें',
  vehicleSent: 'अनुरोध भेज दिया गया। नियंत्रण कक्ष गाड़ी भेजेगा।', reached: 'आश्रय स्थल पहुँच गए', markedSafe: 'आपको सुरक्षित दर्ज कर लिया गया है',
  tellFamily: 'परिवार को बताएँ', talk: 'सहायक से बात करें', reportWater: 'पानी की सूचना दें', settings: 'भाषा या जानकारी बदलें',
  incoming: 'चेतावनी कॉल आ रही है', cycloneWarning: 'चक्रवात चेतावनी', officialAlert: 'सरकारी चेतावनी', seeEnglish: 'अंग्रेज़ी में देखें', showOriginal: 'मूल देखें',
  toShelter: '{name} तक', head: '{dir} की ओर चलें', thenIn: '{d} बाद', turnLeft: 'बाएँ मुड़ें', turnRight: 'दाएँ मुड़ें', slightLeft: 'बाएँ रहें',
  slightRight: 'दाएँ रहें', straight: 'सीधे चलें', uturn: 'वापस मुड़ें', arrive: 'आप {name} पहुँच गए हैं। खतरा टलने तक अंदर ही रहें।',
  arriveSoon: 'आश्रय स्थल {d} आगे है', water: '{d} आगे पानी की सूचना है। ऊँचे रास्ते पर रहें।', waterForecast: '{d} आगे बाढ़ का अनुमान है।',
  simulate: 'पैदल रास्ता दिखाएँ', pause: 'रोकें', routeDry: 'रास्ता सूखा रहेगा', routeWet: 'रास्ते में पानी है: आवाज़ के निर्देश मानें',
  safeMsg: 'मैं {shelter} सुरक्षित पहुँच गया/गई हूँ। (प्रलय कवच)', metres: '{n} मीटर', km: '{n} किलोमीटर', back: 'वापस', openMaps: 'Google Maps में खोलें',
  tip_general: 'पहचान पत्र, दवाइयाँ, पानी, टॉर्च और फ़ोन चार्जर साथ रखें।',
  tip_elderly: 'बुज़ुर्गों के साथ जल्दी निकलें। चलना मुश्किल हो तो गाड़ी माँगें।',
  tip_children: 'बच्चों के लिए पानी, सूखा खाना और कपड़े रखें।',
  tip_disabled: 'अभी गाड़ी माँगें। हवा तेज़ होने का इंतज़ार न करें।',
  tip_pregnant: 'उनके डॉक्टरी कागज़ साथ रखें और आश्रय में कर्मचारियों को बताएँ।',
  tip_livestock: 'पशुओं को खोलकर ऊँची जगह ले जाएँ। उनके लिए पीछे न रुकें।',
  tip_boat: 'नाव किनारे खींचकर बाँध दें। समुद्र में न जाएँ।',
  dirs: 'उत्तर|उत्तर-पूर्व|पूर्व|दक्षिण-पूर्व|दक्षिण|दक्षिण-पश्चिम|पश्चिम|उत्तर-पश्चिम',
}

const or: Strings = {
  chooseLang: 'ଆପଣଙ୍କ ଭାଷା ବାଛନ୍ତୁ', whereAreYou: 'ଆପଣ କେଉଁଠି ଅଛନ୍ତି?', useGps: 'ମୋ ଅବସ୍ଥାନ ବ୍ୟବହାର କରନ୍ତୁ', locating: 'ଆପଣଙ୍କୁ ଖୋଜୁଛି…',
  gpsFailed: 'ଆପଣଙ୍କ ଅବସ୍ଥାନ ମିଳିଲା ନାହିଁ। ତଳେ ଆପଣଙ୍କ ଗାଁ ବାଛନ୍ତୁ।', pickVillage: 'କିମ୍ବା ଆପଣଙ୍କ ଗାଁ ବାଛନ୍ତୁ',
  whoWithYou: 'ଆପଣଙ୍କ ସହ କିଏ ଅଛନ୍ତି?', whoHint: 'ଯାହାଦ୍ୱାରା ଆମେ ଠିକ୍ ପରାମର୍ଶ ଦେଇପାରିବା', next: 'ଆଗକୁ', start: 'ଆରମ୍ଭ କରନ୍ତୁ',
  elderly: 'ବୟସ୍କ ବ୍ୟକ୍ତି', children: 'ଛୋଟ ପିଲା', disabled: 'ଯିଏ ବେଶୀ ଚାଲିପାରନ୍ତି ନାହିଁ', pregnant: 'ଗର୍ଭବତୀ ମହିଳା', livestock: 'ଗାଈ କିମ୍ବା ଛେଳି', boat: 'ମାଛ ଧରା ଡଙ୍ଗା',
  noAlert: '{place} ପାଇଁ ବର୍ତ୍ତମାନ କୌଣସି ସରକାରୀ ସତର୍କତା ନାହିଁ।', alertWillCome: 'ଜିଲ୍ଲାରୁ ସତର୍କତା ଆସିଲେ ଏହି ଫୋନ୍ ବାଜିବ ଏବଂ ପଢ଼ି ଶୁଣାଇବ।',
  getReady: 'ପ୍ରସ୍ତୁତ ହୁଅନ୍ତୁ', actNow: 'ଏବେ ଆଶ୍ରୟସ୍ଥଳୀକୁ ଯାଆନ୍ତୁ', leaveBy: '{time} ପୂର୍ବରୁ ବାହାରନ୍ତୁ', walkMin: '{n} ମିନିଟ୍ ଚାଲି',
  listen: 'ଶୁଣନ୍ତୁ', guideMe: 'ମୋତେ ବାଟ ଦେଖାନ୍ତୁ', needHelp: 'ମୋତେ ସାହାଯ୍ୟ ଦରକାର', sendVehicle: 'ମୋ ପାଇଁ ଗାଡ଼ି ପଠାନ୍ତୁ',
  vehicleSent: 'ଅନୁରୋଧ ପଠାଗଲା। ନିୟନ୍ତ୍ରଣ କକ୍ଷ ଗାଡ଼ି ପଠାଇବ।', reached: 'ଆଶ୍ରୟସ୍ଥଳୀରେ ପହଞ୍ଚିଗଲି', markedSafe: 'ଆପଣ ସୁରକ୍ଷିତ ବୋଲି ଲେଖାଗଲା',
  tellFamily: 'ପରିବାରକୁ ଜଣାନ୍ତୁ', talk: 'ସହାୟକ ସହ କଥା ହୁଅନ୍ତୁ', reportWater: 'ପାଣି ବିଷୟରେ ଜଣାନ୍ତୁ', settings: 'ଭାଷା କିମ୍ବା ତଥ୍ୟ ବଦଳାନ୍ତୁ',
  incoming: 'ସତର୍କତା କଲ୍ ଆସୁଛି', cycloneWarning: 'ଘୂର୍ଣ୍ଣିବାତ ସତର୍କତା', officialAlert: 'ସରକାରୀ ସତର୍କତା', seeEnglish: 'ଇଂରାଜୀରେ ଦେଖନ୍ତୁ', showOriginal: 'ମୂଳ ଦେଖନ୍ତୁ',
  toShelter: '{name} ପର୍ଯ୍ୟନ୍ତ', head: '{dir} ଆଡ଼କୁ ଚାଲନ୍ତୁ', thenIn: '{d} ପରେ', turnLeft: 'ବାମକୁ ବୁଲନ୍ତୁ', turnRight: 'ଡାହାଣକୁ ବୁଲନ୍ତୁ', slightLeft: 'ବାମ ପଟେ ରୁହନ୍ତୁ',
  slightRight: 'ଡାହାଣ ପଟେ ରୁହନ୍ତୁ', straight: 'ସିଧା ଚାଲନ୍ତୁ', uturn: 'ପଛକୁ ଫେରନ୍ତୁ', arrive: 'ଆପଣ {name} ରେ ପହଞ୍ଚିଗଲେ। ବିପଦ ନ ଟଳିବା ପର୍ଯ୍ୟନ୍ତ ଭିତରେ ରୁହନ୍ତୁ।',
  arriveSoon: 'ଆଶ୍ରୟସ୍ଥଳୀ {d} ଆଗରେ', water: '{d} ଆଗରେ ପାଣି ଥିବା ଖବର ଅଛି। ଉଚ୍ଚ ରାସ୍ତାରେ ରୁହନ୍ତୁ।', waterForecast: '{d} ଆଗରେ ବନ୍ୟାର ଆଶଙ୍କା ଅଛି।',
  simulate: 'ଚାଲିବା ବାଟ ଦେଖାନ୍ତୁ', pause: 'ରୋକନ୍ତୁ', routeDry: 'ରାସ୍ତା ଶୁଖିଲା ରହିବ', routeWet: 'ବାଟରେ ପାଣି ଅଛି: ସ୍ୱର ନିର୍ଦ୍ଦେଶ ମାନନ୍ତୁ',
  safeMsg: 'ମୁଁ {shelter} ରେ ସୁରକ୍ଷିତ ଭାବେ ପହଞ୍ଚିଛି। (ପ୍ରଳୟ କବଚ)', metres: '{n} ମିଟର', km: '{n} କିଲୋମିଟର', back: 'ପଛକୁ', openMaps: 'Google Maps ରେ ଖୋଲନ୍ତୁ',
  tip_general: 'ପରିଚୟ ପତ୍ର, ଔଷଧ, ପାଣି, ଟର୍ଚ୍ଚ ଓ ଫୋନ୍ ଚାର୍ଜର ସାଙ୍ଗରେ ନିଅନ୍ତୁ।',
  tip_elderly: 'ବୟସ୍କଙ୍କ ସହ ଶୀଘ୍ର ବାହାରନ୍ତୁ। ଚାଲିବା କଷ୍ଟ ହେଲେ ଗାଡ଼ି ମାଗନ୍ତୁ।',
  tip_children: 'ପିଲାଙ୍କ ପାଇଁ ପାଣି, ଶୁଖିଲା ଖାଦ୍ୟ ଓ ଲୁଗା ନିଅନ୍ତୁ।',
  tip_disabled: 'ଏବେ ଗାଡ଼ି ମାଗନ୍ତୁ। ପବନ ବଢ଼ିବା ପର୍ଯ୍ୟନ୍ତ ଅପେକ୍ଷା କରନ୍ତୁ ନାହିଁ।',
  tip_pregnant: 'ତାଙ୍କ ଡାକ୍ତରୀ କାଗଜ ନିଅନ୍ତୁ ଏବଂ ଆଶ୍ରୟସ୍ଥଳୀରେ କର୍ମଚାରୀଙ୍କୁ ଜଣାନ୍ତୁ।',
  tip_livestock: 'ପଶୁଙ୍କୁ ଖୋଲି ଉଚ୍ଚ ସ୍ଥାନକୁ ନିଅନ୍ତୁ। ସେମାନଙ୍କ ପାଇଁ ପଛରେ ରୁହନ୍ତୁ ନାହିଁ।',
  tip_boat: 'ଡଙ୍ଗାକୁ କୂଳକୁ ଟାଣି ବାନ୍ଧି ଦିଅନ୍ତୁ। ସମୁଦ୍ରକୁ ଯାଆନ୍ତୁ ନାହିଁ।',
  dirs: 'ଉତ୍ତର|ଉତ୍ତର-ପୂର୍ବ|ପୂର୍ବ|ଦକ୍ଷିଣ-ପୂର୍ବ|ଦକ୍ଷିଣ|ଦକ୍ଷିଣ-ପଶ୍ଚିମ|ପଶ୍ଚିମ|ଉତ୍ତର-ପଶ୍ଚିମ',
}

const bn: Strings = {
  chooseLang: 'আপনার ভাষা বেছে নিন', whereAreYou: 'আপনি কোথায় আছেন?', useGps: 'আমার অবস্থান ব্যবহার করুন', locating: 'আপনাকে খোঁজা হচ্ছে…',
  gpsFailed: 'আপনার অবস্থান পাওয়া যায়নি। নীচে আপনার গ্রাম বেছে নিন।', pickVillage: 'অথবা আপনার গ্রাম বেছে নিন',
  whoWithYou: 'আপনার সঙ্গে কে আছেন?', whoHint: 'যাতে আমরা সঠিক পরামর্শ দিতে পারি', next: 'পরের ধাপ', start: 'শুরু করুন',
  elderly: 'বয়স্ক মানুষ', children: 'ছোট শিশু', disabled: 'যিনি বেশি হাঁটতে পারেন না', pregnant: 'গর্ভবতী মহিলা', livestock: 'গরু বা ছাগল', boat: 'মাছ ধরার নৌকা',
  noAlert: '{place}-এর জন্য এখন কোনো সরকারি সতর্কতা নেই।', alertWillCome: 'জেলা থেকে সতর্কতা এলে এই ফোন বাজবে এবং পড়ে শোনাবে।',
  getReady: 'প্রস্তুত থাকুন', actNow: 'এখনই আশ্রয়কেন্দ্রে যান', leaveBy: '{time}-এর আগে বেরিয়ে পড়ুন', walkMin: '{n} মিনিট হাঁটা',
  listen: 'শুনুন', guideMe: 'আমাকে পথ দেখান', needHelp: 'আমার সাহায্য দরকার', sendVehicle: 'আমার জন্য গাড়ি পাঠান',
  vehicleSent: 'অনুরোধ পাঠানো হয়েছে। নিয়ন্ত্রণ কক্ষ গাড়ি পাঠাবে।', reached: 'আশ্রয়কেন্দ্রে পৌঁছে গেছি', markedSafe: 'আপনাকে নিরাপদ হিসেবে চিহ্নিত করা হয়েছে',
  tellFamily: 'পরিবারকে জানান', talk: 'সহায়কের সঙ্গে কথা বলুন', reportWater: 'জলের খবর দিন', settings: 'ভাষা বা তথ্য বদলান',
  incoming: 'সতর্কতা কল আসছে', cycloneWarning: 'ঘূর্ণিঝড় সতর্কতা', officialAlert: 'সরকারি সতর্কতা', seeEnglish: 'ইংরেজিতে দেখুন', showOriginal: 'মূল দেখুন',
  toShelter: '{name} পর্যন্ত', head: '{dir} দিকে হাঁটুন', thenIn: '{d} পরে', turnLeft: 'বাঁ দিকে ঘুরুন', turnRight: 'ডান দিকে ঘুরুন', slightLeft: 'বাঁ দিক ধরে চলুন',
  slightRight: 'ডান দিক ধরে চলুন', straight: 'সোজা চলুন', uturn: 'পিছনে ঘুরুন', arrive: 'আপনি {name}-এ পৌঁছে গেছেন। বিপদ না কাটা পর্যন্ত ভিতরে থাকুন।',
  arriveSoon: 'আশ্রয়কেন্দ্র {d} সামনে', water: '{d} সামনে জল জমার খবর আছে। উঁচু রাস্তা ধরে চলুন।', waterForecast: '{d} সামনে বন্যার আশঙ্কা আছে।',
  simulate: 'হাঁটার পথ দেখান', pause: 'থামুন', routeDry: 'রাস্তা শুকনো থাকবে', routeWet: 'পথে জল আছে: কণ্ঠের নির্দেশ মেনে চলুন',
  safeMsg: 'আমি নিরাপদে {shelter}-এ পৌঁছেছি। (প্রলয় কবচ)', metres: '{n} মিটার', km: '{n} কিলোমিটার', back: 'ফিরে যান', openMaps: 'Google Maps-এ খুলুন',
  tip_general: 'পরিচয়পত্র, ওষুধ, জল, টর্চ আর ফোনের চার্জার সঙ্গে রাখুন।',
  tip_elderly: 'বয়স্কদের নিয়ে আগেভাগে বেরোন। হাঁটতে কষ্ট হলে গাড়ি চান।',
  tip_children: 'শিশুদের জন্য জল, শুকনো খাবার আর জামাকাপড় নিন।',
  tip_disabled: 'এখনই গাড়ি চান। ঝড় শুরু হওয়া পর্যন্ত অপেক্ষা করবেন না।',
  tip_pregnant: 'ওঁর চিকিৎসার কাগজ সঙ্গে নিন এবং আশ্রয়কেন্দ্রের কর্মীদের জানান।',
  tip_livestock: 'পশুদের খুলে উঁচু জায়গায় নিয়ে যান। ওদের জন্য পিছনে থেকে যাবেন না।',
  tip_boat: 'নৌকা ডাঙায় টেনে বেঁধে রাখুন। সমুদ্রে যাবেন না।',
  dirs: 'উত্তর|উত্তর-পূর্ব|পূর্ব|দক্ষিণ-পূর্ব|দক্ষিণ|দক্ষিণ-পশ্চিম|পশ্চিম|উত্তর-পশ্চিম',
}

const te: Strings = {
  chooseLang: 'మీ భాషను ఎంచుకోండి', whereAreYou: 'మీరు ఎక్కడ ఉన్నారు?', useGps: 'నా లొకేషన్ వాడండి', locating: 'మిమ్మల్ని వెతుకుతోంది…',
  gpsFailed: 'మీ లొకేషన్ దొరకలేదు. కింద మీ గ్రామాన్ని ఎంచుకోండి.', pickVillage: 'లేదా మీ గ్రామాన్ని ఎంచుకోండి',
  whoWithYou: 'మీతో ఎవరు ఉన్నారు?', whoHint: 'సరైన సలహా ఇవ్వడానికి', next: 'తర్వాత', start: 'ప్రారంభించండి',
  elderly: 'వృద్ధులు', children: 'చిన్న పిల్లలు', disabled: 'ఎక్కువ నడవలేని వారు', pregnant: 'గర్భిణీ స్త్రీ', livestock: 'ఆవులు లేదా మేకలు', boat: 'చేపల పడవ',
  noAlert: '{place}కి ప్రస్తుతం ప్రభుత్వ హెచ్చరిక లేదు.', alertWillCome: 'జిల్లా హెచ్చరిక జారీ చేస్తే ఈ ఫోన్ మోగి, దాన్ని చదివి వినిపిస్తుంది.',
  getReady: 'సిద్ధంగా ఉండండి', actNow: 'ఇప్పుడే ఆశ్రయ కేంద్రానికి వెళ్ళండి', leaveBy: '{time} లోపు బయలుదేరండి', walkMin: '{n} నిమిషాల నడక',
  listen: 'వినండి', guideMe: 'నాకు దారి చూపించండి', needHelp: 'నాకు సహాయం కావాలి', sendVehicle: 'నా కోసం వాహనం పంపండి',
  vehicleSent: 'అభ్యర్థన పంపబడింది. కంట్రోల్ రూమ్ వాహనం పంపుతుంది.', reached: 'ఆశ్రయ కేంద్రానికి చేరుకున్నాను', markedSafe: 'మీరు సురక్షితంగా ఉన్నట్లు నమోదైంది',
  tellFamily: 'కుటుంబానికి తెలియజేయండి', talk: 'సహాయక్‌తో మాట్లాడండి', reportWater: 'నీటి గురించి తెలియజేయండి', settings: 'భాష లేదా వివరాలు మార్చండి',
  incoming: 'హెచ్చరిక కాల్ వస్తోంది', cycloneWarning: 'తుఫాను హెచ్చరిక', officialAlert: 'ప్రభుత్వ హెచ్చరిక', seeEnglish: 'ఇంగ్లీషులో చూడండి', showOriginal: 'అసలు చూడండి',
  toShelter: '{name} వరకు', head: '{dir} వైపు నడవండి', thenIn: '{d} తర్వాత', turnLeft: 'ఎడమకు తిరగండి', turnRight: 'కుడికి తిరగండి', slightLeft: 'ఎడమ వైపు ఉండండి',
  slightRight: 'కుడి వైపు ఉండండి', straight: 'నేరుగా వెళ్ళండి', uturn: 'వెనక్కి తిరగండి', arrive: 'మీరు {name} చేరుకున్నారు. ప్రమాదం తొలగే వరకు లోపలే ఉండండి.',
  arriveSoon: 'ఆశ్రయ కేంద్రం {d} ముందు ఉంది', water: '{d} ముందు నీరు ఉన్నట్లు సమాచారం. ఎత్తైన దారిలో వెళ్ళండి.', waterForecast: '{d} ముందు వరద వచ్చే అవకాశం ఉంది.',
  simulate: 'నడక దారి చూపించండి', pause: 'ఆపండి', routeDry: 'దారి పొడిగా ఉంటుంది', routeWet: 'దారిలో నీరు ఉంది: వాయిస్ సూచనలు పాటించండి',
  safeMsg: 'నేను {shelter}కి సురక్షితంగా చేరుకున్నాను. (ప్రళయ కవచ్)', metres: '{n} మీటర్లు', km: '{n} కిలోమీటర్లు', back: 'వెనక్కి', openMaps: 'Google Maps లో తెరవండి',
  tip_general: 'గుర్తింపు కార్డు, మందులు, నీరు, టార్చ్, ఫోన్ ఛార్జర్ తీసుకెళ్ళండి.',
  tip_elderly: 'వృద్ధులతో ముందుగానే బయలుదేరండి. నడవడం కష్టమైతే వాహనం అడగండి.',
  tip_children: 'పిల్లల కోసం నీరు, పొడి ఆహారం, బట్టలు తీసుకెళ్ళండి.',
  tip_disabled: 'ఇప్పుడే వాహనం అడగండి. గాలి పెరిగే వరకు ఆగకండి.',
  tip_pregnant: 'ఆమె వైద్య పత్రాలు తీసుకెళ్ళి, ఆశ్రయ కేంద్రం సిబ్బందికి చెప్పండి.',
  tip_livestock: 'పశువులను విప్పి ఎత్తైన ప్రదేశానికి తరలించండి. వాటి కోసం వెనుక ఉండకండి.',
  tip_boat: 'పడవను ఒడ్డుకు లాగి కట్టేయండి. సముద్రంలోకి వెళ్ళకండి.',
  dirs: 'ఉత్తరం|ఈశాన్యం|తూర్పు|ఆగ్నేయం|దక్షిణం|నైరుతి|పడమర|వాయువ్యం',
}

const ta: Strings = {
  chooseLang: 'உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்', whereAreYou: 'நீங்கள் எங்கே இருக்கிறீர்கள்?', useGps: 'என் இருப்பிடத்தைப் பயன்படுத்து', locating: 'உங்களைத் தேடுகிறது…',
  gpsFailed: 'உங்கள் இருப்பிடம் கிடைக்கவில்லை. கீழே உங்கள் ஊரைத் தேர்ந்தெடுக்கவும்.', pickVillage: 'அல்லது உங்கள் ஊரைத் தேர்ந்தெடுக்கவும்',
  whoWithYou: 'உங்களுடன் யார் இருக்கிறார்கள்?', whoHint: 'சரியான ஆலோசனை தர', next: 'அடுத்து', start: 'தொடங்கு',
  elderly: 'முதியவர்', children: 'சிறு குழந்தைகள்', disabled: 'அதிகம் நடக்க முடியாதவர்', pregnant: 'கர்ப்பிணிப் பெண்', livestock: 'மாடு அல்லது ஆடு', boat: 'மீன்பிடி படகு',
  noAlert: '{place}க்கு இப்போது அரசு எச்சரிக்கை எதுவும் இல்லை.', alertWillCome: 'மாவட்டம் எச்சரிக்கை வெளியிட்டால் இந்த ஃபோன் ஒலித்து அதை வாசித்துக் காட்டும்.',
  getReady: 'தயாராக இருங்கள்', actNow: 'இப்போதே பாதுகாப்பு மையத்துக்குச் செல்லுங்கள்', leaveBy: '{time}க்கு முன் புறப்படுங்கள்', walkMin: '{n} நிமிட நடை',
  listen: 'கேளுங்கள்', guideMe: 'எனக்கு வழி காட்டு', needHelp: 'எனக்கு உதவி வேண்டும்', sendVehicle: 'எனக்கு வாகனம் அனுப்புங்கள்',
  vehicleSent: 'கோரிக்கை அனுப்பப்பட்டது. கட்டுப்பாட்டு அறை வாகனம் அனுப்பும்.', reached: 'பாதுகாப்பு மையத்தை அடைந்தேன்', markedSafe: 'நீங்கள் பாதுகாப்பாக இருப்பதாகப் பதிவானது',
  tellFamily: 'குடும்பத்துக்குத் தெரிவி', talk: 'சகாயக்குடன் பேசுங்கள்', reportWater: 'தண்ணீர் பற்றித் தெரிவி', settings: 'மொழி அல்லது விவரங்களை மாற்று',
  incoming: 'எச்சரிக்கை அழைப்பு வருகிறது', cycloneWarning: 'புயல் எச்சரிக்கை', officialAlert: 'அரசு எச்சரிக்கை', seeEnglish: 'ஆங்கிலத்தில் பார்', showOriginal: 'மூலத்தைப் பார்',
  toShelter: '{name} வரை', head: '{dir} நோக்கி நடங்கள்', thenIn: '{d} பிறகு', turnLeft: 'இடது பக்கம் திரும்புங்கள்', turnRight: 'வலது பக்கம் திரும்புங்கள்',
  slightLeft: 'இடது பக்கமாகச் செல்லுங்கள்', slightRight: 'வலது பக்கமாகச் செல்லுங்கள்', straight: 'நேராகச் செல்லுங்கள்', uturn: 'திரும்பிச் செல்லுங்கள்',
  arrive: 'நீங்கள் {name} அடைந்துவிட்டீர்கள். ஆபத்து நீங்கும் வரை உள்ளேயே இருங்கள்.',
  arriveSoon: 'பாதுகாப்பு மையம் {d} முன்னால் உள்ளது', water: '{d} முன்னால் தண்ணீர் இருப்பதாகத் தகவல். உயரமான சாலையில் செல்லுங்கள்.', waterForecast: '{d} முன்னால் வெள்ளம் வர வாய்ப்பு உள்ளது.',
  simulate: 'நடை வழியைக் காட்டு', pause: 'நிறுத்து', routeDry: 'சாலை வறண்டே இருக்கும்', routeWet: 'வழியில் தண்ணீர் உள்ளது: குரல் வழிகாட்டலைப் பின்பற்றுங்கள்',
  safeMsg: 'நான் {shelter}ஐ பாதுகாப்பாக அடைந்தேன். (பிரளய கவச்)', metres: '{n} மீட்டர்', km: '{n} கிலோமீட்டர்', back: 'பின்செல்', openMaps: 'Google Maps இல் திற',
  tip_general: 'அடையாள அட்டை, மருந்துகள், தண்ணீர், டார்ச், ஃபோன் சார்ஜர் எடுத்துச் செல்லுங்கள்.',
  tip_elderly: 'முதியவர்களுடன் முன்கூட்டியே புறப்படுங்கள். நடக்க கடினமானால் வாகனம் கேளுங்கள்.',
  tip_children: 'குழந்தைகளுக்குத் தண்ணீர், உலர் உணவு, மாற்று உடை எடுத்துச் செல்லுங்கள்.',
  tip_disabled: 'இப்போதே வாகனம் கேளுங்கள். காற்று வலுக்கும் வரை காத்திருக்காதீர்கள்.',
  tip_pregnant: 'அவரது மருத்துவ ஆவணங்களை எடுத்துச் சென்று, மைய ஊழியர்களிடம் தெரிவியுங்கள்.',
  tip_livestock: 'கால்நடைகளை அவிழ்த்து உயரமான இடத்துக்குக் கொண்டு செல்லுங்கள். அவற்றுக்காகப் பின்தங்காதீர்கள்.',
  tip_boat: 'படகைக் கரைக்கு இழுத்துக் கட்டுங்கள். கடலுக்குச் செல்லாதீர்கள்.',
  dirs: 'வடக்கு|வடகிழக்கு|கிழக்கு|தென்கிழக்கு|தெற்கு|தென்மேற்கு|மேற்கு|வடமேற்கு',
}

const ALL: Record<Lang, Strings> = { en, hi, or, bn, te, ta }

export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const s = ALL[(lang as Lang)]?.[key] ?? en[key] ?? key
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

export function dirName(lang: string, bearing: number): string {
  return t(lang, 'dirs').split('|')[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

export function fmtDist(lang: string, m: number): string {
  return m >= 1000 ? t(lang, 'km', { n: (m / 1000).toFixed(1) }) : t(lang, 'metres', { n: Math.max(10, Math.round(m / 10) * 10) })
}

/** Suggest a language from where the person is, then from the device. */
export function suggestLang(district?: string): Lang {
  const d = (district ?? '').toLowerCase()
  if (/medinipur|kolkata|parganas|howrah/.test(d)) return 'bn'
  if (/srikakulam|visakhapatnam|vizianagaram|godavari|krishna|guntur|nellore/.test(d)) return 'te'
  if (/chennai|cuddalore|nagapattinam|tiruvallur|kanchipuram/.test(d)) return 'ta'
  if (d) return 'or'
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2)
  return (LANGS as string[]).includes(nav) ? (nav as Lang) : 'or'
}

// ---------- the person's profile, kept on the phone ----------

export interface Profile { lang: Lang; household: Need[]; done: boolean }
const KEY = 'pk-profile'

export function loadProfile(): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null')
    return p && p.done ? p : null
  } catch { return null }
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode: keep it for this visit only */ }
}
