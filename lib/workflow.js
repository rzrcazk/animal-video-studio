import fs from "node:fs/promises";
import path from "node:path";

const HOT_ANIMALS = [
  "蜜獾", "螳螂虾", "袋熊", "雪豹", "鲸头鹳", "水獭", "狐獴", "北极狐",
  "翻车鱼", "章鱼", "树懒", "河马", "貂熊", "穿山甲", "座头鲸"
];

const ANIMAL_ALIASES = new Map([
  ["卡皮吧啦", "卡皮巴拉"],
  ["卡皮巴啦", "卡皮巴拉"],
  ["卡皮巴拉", "卡皮巴拉"],
  ["水豚", "卡皮巴拉"],
  ["豚鼠王", "卡皮巴拉"]
]);

const AUDIENCE_LIBRARY = {
  family: {
    id: "family",
    name: "亲子/小朋友友好",
    note: "表达更温暖，轻科普、轻搞笑，不做吓人的冲突渲染"
  },
  general: {
    id: "general",
    name: "大众短视频",
    note: "节奏更短视频化，有反差、有梗，也保留科学解释"
  },
  hardcore: {
    id: "hardcore",
    name: "硬核科普",
    note: "减少拟人玩笑，强化结构、行为和生态逻辑"
  }
};

const ANIMAL_PROFILES = {
  "蜜獾": {
    habitat: "非洲稀树草原和灌木地",
    look: "身体低矮结实，背部银灰色，腹部深黑色，皮毛粗硬，眼神警觉",
    facts: ["皮肤厚且松弛", "对蜂毒有一定抵抗力", "会挖洞、攀爬，也敢抢食"],
    props: ["蜂巢", "野蜂群", "枯树洞"],
    styleId: "action",
    personality: "莽中带精，像荒野里的小型硬核选手",
    humor: "用“别人是求生，它像来收保护费”这种反差梗点到为止"
  },
  "貂熊": {
    habitat: "北方针叶林和积雪山地",
    look: "体型像小熊，深褐色厚毛，肩背有浅色弧形斑纹，爪子宽大有力，尾巴蓬松",
    facts: ["嗅觉非常灵敏", "咬合力强，能处理冻硬的食物", "脚掌宽大，适合在雪地行动"],
    props: ["雪地足迹", "倒木", "冻肉残骸"],
    styleId: "action",
    personality: "冷地带狠角色，沉默、耐力强、气场压迫",
    humor: "像雪地里不说话但谁都不想惹的硬汉"
  },
  "袋熊": {
    habitat: "澳洲林地、草坡和洞穴附近",
    look: "身体圆敦，灰褐色短毛，鼻子宽大，四肢短粗，臀部厚实",
    facts: ["臀部骨板很硬", "会挖复杂洞穴", "粪便接近方形，能帮助标记地盘"],
    props: ["洞穴入口", "草根", "方形粪便"],
    styleId: "deadpan",
    personality: "外表憨厚，实际是地下工程师加防守大师",
    humor: "把屁股讲成“自带防盗门”，把方形粪便当自然界离谱设计"
  },
  "雪豹": {
    habitat: "高海拔雪山岩壁",
    look: "银灰色厚毛，黑色玫瑰斑纹，长尾蓬松，浅色眼睛，脚掌宽大",
    facts: ["尾巴很长可保持平衡", "脚掌宽大像天然雪鞋", "能在峭壁间跳跃"],
    props: ["岩壁", "雪坡", "山羊足迹"],
    styleId: "mystery",
    personality: "高冷、克制、像雪山里的无声刺客",
    humor: "少用吵闹梗，偏冷幽默，比如“它不是社恐，它只是海拔太高懒得解释”"
  },
  "螳螂虾": {
    habitat: "热带浅海珊瑚礁和沙质洞穴",
    look: "彩色甲壳，复眼突出，前肢像弹簧拳套，身体有蓝绿橙色金属光泽",
    facts: ["出拳速度极快", "复眼能感知丰富光谱", "会用冲击波击碎猎物外壳"],
    props: ["贝壳", "珊瑚洞穴", "碎裂外壳"],
    styleId: "action",
    personality: "海底拳王，外表花哨，输出暴躁",
    humor: "像把彩虹皮肤和重拳天赋点在同一个角色上"
  },
  "卡皮巴拉": {
    habitat: "南美洲湿地、河岸草地和浅水边",
    look: "体型圆润结实，棕褐色短毛，鼻眼耳位置较高，表情松弛，四肢短而稳",
    facts: ["半水栖生活让它能在水里躲避危险", "门齿会持续生长，需要啃食植物来磨牙", "性情相对温和，常和同伴保持群体警戒"],
    props: ["浅水河岸", "水草", "泥地脚印"],
    styleId: "cozy",
    personality: "松弛、稳定、像湿地里的情绪管理大师",
    humor: "用“不是摆烂，是节能模式”这种轻松梗，但别把它写成纯搞笑动物"
  }
};

const DEFAULT_PROFILE = {
  habitat: "真实野外环境",
  look: "外形准确，毛发或皮肤纹理清晰，身体比例自然，眼神灵动警觉",
  facts: ["有独特的生存本领", "幼年阶段需要练习捕食或躲避危险", "身体结构和行为习惯共同塑造了它的强项"],
  props: ["洞穴入口", "草丛", "石块"],
  personality: "先用这个动物最有辨识度的反差做性格，不套用固定人设",
  humor: "每 4 到 6 句放一个轻梗，笑点服务科普，不打断叙事"
};

const STYLE_LIBRARY = [
  {
    id: "deadpan",
    name: "冷面吐槽型",
    promise: "用一本正经的观察讲离谱行为，适合外表反差大的动物",
    opening: (animal, name) => `如果${animal}也有朋友圈，${name}大概每天只发两个字：还行。`,
    button: (name) => `你以为它在发呆，其实${name}只是在用最低能耗处理一堆生存问题。`,
    closer: (animal) => `所以${animal}不是无聊，它只是把日子过成了高级省电模式。`
  },
  {
    id: "action",
    name: "热血闯关型",
    promise: "把觅食和躲避写成小型闯关，适合速度、力量或捕食能力强的动物",
    opening: (animal, name) => `别看${animal}个头不一定夸张，${name}今天一出场，气氛就像荒野开了挑战模式。`,
    button: (name) => `${name}不是一路莽过去，它每一次停顿，都是在重新计算下一步。`,
    closer: (animal) => `所以${animal}真正厉害的不是赢一次，而是总能在下一关换一种活法。`
  },
  {
    id: "cozy",
    name: "治愈轻喜剧型",
    promise: "用松弛感和轻喜剧承接科普，适合温和、圆润或社群感强的动物",
    opening: (animal, name) => `有人问，${animal}难道不无聊吗？${name}抬了抬眼皮，像是在说：你先别急。`,
    button: (name) => `${name}的节奏看着慢，其实每一步都在省力、避险、顺便照顾自己的胃。`,
    closer: (animal) => `这大概就是${animal}想告诉我们的事：生活不一定要赢麻，舒服并且活得稳，也很了不起。`
  },
  {
    id: "mystery",
    name: "悬疑揭秘型",
    promise: "先制造一个怪问题，再逐层解释身体结构和行为逻辑",
    opening: (animal, name) => `第一次看见${animal}，很多人都会冒出同一个问题：${name}到底凭什么这样活着？`,
    button: (name) => `答案不在玄学里，而藏在${name}的身体结构、习惯路线和每一次试探里。`,
    closer: (animal) => `看懂这些细节，${animal}就不再只是一个标签，而是一套被环境慢慢打磨出来的生存方案。`
  }
];

const STAGES = [
  { key: "hook", label: "开场钩子", scene: "主栖息地全景", prop: "" },
  { key: "appear", label: "主角登场", scene: "安全藏身处", prop: "" },
  { key: "goal", label: "发现目标", scene: "觅食路线", prop: "食物线索" },
  { key: "obstacle", label: "第一次麻烦", scene: "障碍点", prop: "石块或倒木" },
  { key: "scan", label: "观察判断", scene: "低草丛边缘", prop: "足迹" },
  { key: "chase", label: "追逐开始", scene: "开阔地带", prop: "" },
  { key: "science-a", label: "身体优势", scene: "主角特写背景", prop: "" },
  { key: "science-b", label: "关键本领", scene: "行为展示场景", prop: "" },
  { key: "fail", label: "第一次失败", scene: "乱草或碎石处", prop: "草屑" },
  { key: "recover", label: "重新判断", scene: "静止观察点", prop: "地面痕迹" },
  { key: "route", label: "改变路线", scene: "侧向绕行路线", prop: "" },
  { key: "action", label: "再次行动", scene: "关键动作区域", prop: "尘土或雪雾" },
  { key: "lesson", label: "试错解释", scene: "环境细节场景", prop: "" },
  { key: "adapt", label: "适应环境", scene: "掩护物附近", prop: "灌木或石缝" },
  { key: "wide", label: "生态视角", scene: "栖息地远景", prop: "" },
  { key: "close", label: "收束结尾", scene: "安全休息点", prop: "战利品或食物" }
];

export function pickAnimal(input) {
  if (input && input.trim()) return normalizeAnimalInput(input).animal;
  const index = new Date().getDate() % HOT_ANIMALS.length;
  return HOT_ANIMALS[index];
}

export function normalizeAnimalInput(input = "") {
  const raw = input.trim();
  if (!raw) {
    const index = new Date().getDate() % HOT_ANIMALS.length;
    const animal = HOT_ANIMALS[index];
    return { animal, rawInput: "", matchedAlias: false, displayName: `${animal}（自动选择）` };
  }
  const compact = raw.replace(/\s+/g, "");
  const animal = ANIMAL_ALIASES.get(compact) || compact;
  const matchedAlias = animal !== compact;
  return {
    animal,
    rawInput: raw,
    matchedAlias,
    displayName: matchedAlias ? `${raw} -> ${animal}` : animal
  };
}

function profileFor(animal) {
  return ANIMAL_PROFILES[animal] || DEFAULT_PROFILE;
}

function normalizeProfile(profile = {}) {
  return {
    habitat: profile.habitat || DEFAULT_PROFILE.habitat,
    look: profile.look || DEFAULT_PROFILE.look,
    facts: Array.isArray(profile.facts) && profile.facts.length ? profile.facts.slice(0, 5) : DEFAULT_PROFILE.facts,
    props: Array.isArray(profile.props) && profile.props.length ? profile.props.slice(0, 8) : DEFAULT_PROFILE.props,
    styleId: profile.styleId || "",
    personality: profile.personality || DEFAULT_PROFILE.personality,
    humor: profile.humor || DEFAULT_PROFILE.humor
  };
}

function heroName(animal) {
  return `${animal[0]}小${animal.at(-1)}`;
}

function estimateDuration(text, index) {
  const len = [...text].length;
  const spokenSeconds = Math.ceil(len / 4.3);
  if (spokenSeconds <= 5) return 5;
  if (spokenSeconds >= 10) return 10;
  return index % 5 === 0 ? Math.min(10, spokenSeconds + 1) : spokenSeconds;
}

function estimateVoiceSeconds(text) {
  return Math.round([...text].length / 4.3);
}

function splitSentences(script) {
  return script
    .replace(/\s+/g, "")
    .split(/(?<=[。！？])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanSentence(sentence) {
  return sentence.replace(/[。！？]$/u, "");
}

function styleFor(animal, profile, styleOffset = 0, requestedStyleId = "") {
  if (requestedStyleId) {
    const requested = STYLE_LIBRARY.find((style) => style.id === requestedStyleId);
    if (requested) return requested;
  }
  if (profile.styleId) {
    const baseIndex = STYLE_LIBRARY.findIndex((style) => style.id === profile.styleId);
    if (baseIndex >= 0) return STYLE_LIBRARY[(baseIndex + styleOffset) % STYLE_LIBRARY.length];
  }
  if (animal.includes("卡皮") || animal.includes("水獭") || animal.includes("树懒")) return STYLE_LIBRARY.find((style) => style.id === "cozy");
  if (animal.includes("雪豹") || animal.includes("章鱼") || animal.includes("穿山甲")) return STYLE_LIBRARY.find((style) => style.id === "mystery");
  if (animal.includes("蜜獾") || animal.includes("貂熊") || animal.includes("螳螂虾") || animal.includes("河马")) return STYLE_LIBRARY.find((style) => style.id === "action");
  const codeSum = [...animal].reduce((sum, char) => sum + char.codePointAt(0), 0);
  return STYLE_LIBRARY[(codeSum + styleOffset) % STYLE_LIBRARY.length];
}

function buildScript(animal, profile, scriptRevision = 0, requestedStyleId = "", audienceId = "general") {
  const name = heroName(animal);
  const facts = profile.facts;
  const style = styleFor(animal, profile, scriptRevision % STYLE_LIBRARY.length, requestedStyleId);
  const audience = AUDIENCE_LIBRARY[audienceId] || AUDIENCE_LIBRARY.general;
  const riskLine = [
    `今天它要解决的不是大场面，而是最实在的问题：吃什么，往哪走，危险从哪来。`,
    `今天的任务也不复杂：先找到能吃的，再尽量别把自己送进麻烦里。`,
    `它这一趟看着随意，其实每一步都绕不开三个字：活下去。`,
    `别看画面很平静，野外真正难的，往往就是把普通一天顺利过完。`
  ][scriptRevision % 4];
  const retryLine = [
    `${name}第一次尝试没成功，场面略尴尬，但尴尬也是野外训练的一部分。`,
    `第一回合它没占到便宜，甚至有点像走错片场，但野外本来就没有完美剧本。`,
    `${name}先吃了个小亏，不过这不丢人，很多生存技巧都是从判断失误里磨出来的。`,
    `这一下没有得手，它也没有硬演强者，停下来重新看环境才是更聪明的选择。`
  ][scriptRevision % 4];
  const environmentLine = [
    `它会利用水边、草丛、洞口、阴影或者地形，把普通场景变成临时掩护。`,
    `水边、草丛、洞口和阴影，在它眼里都不是背景，而是可以借力的工具。`,
    `同一片环境，别人只看到风景，${name}看到的是路线、距离和安全边界。`,
    `它真正会用的，不只是自己的身体，还有身边每一处能降低风险的地形。`
  ][scriptRevision % 4];
  return [
    style.opening(animal, name),
    `镜头落到${profile.habitat}，${name}慢慢出现，表情很淡定，身体却已经进入工作状态。`,
    riskLine,
    `这只${animal}的气质可以概括成一句话：${profile.personality}。`,
    audience.id === "family" ? `如果是讲给小朋友听，我们可以把它当成一个慢吞吞但很会照顾自己的自然朋友。` : "",
    `${name}先停住，闻一闻风里的味道，再看一看地面的痕迹，像在给今天做风险评估。`,
    `第一个关键点来了，${facts[0]}，这不是装饰，是它处理麻烦的底层配置。`,
    `可自然界不会因为它可爱就放水，刚靠近目标，动静一变，节奏立刻乱了。`,
    retryLine,
    style.button(name),
    `第二个科学点也藏在这里，${facts[1]}，这会直接影响它怎么吃、怎么躲、怎么移动。`,
    `如果把镜头放慢，你会发现它不是乱来，而是在用身体条件选择最省事的路线。`,
    `接下来${name}换了方向，不再硬冲，而是借着环境遮挡，一点点靠近更安全的位置。`,
    `这一步看着平平无奇，却是很多动物能活下来的核心：少犯错，比逞强更重要。`,
    `第三个特点是${facts[2]}，它让${animal}不是孤零零地硬扛，而是能和环境配合。`,
    environmentLine,
    `这时再看${name}，你会发现它的每个小动作，都不是为了卖萌，而是为了少付代价。`,
    `所谓动物行为，往往就是这样：一点身体结构，加上一点经验，再加一点不得不学会的谨慎。`,
    `镜头最后回到${name}身上，它停下来整理自己，像刚刚完成了一次低调但有效的通关。`,
    `它不会知道镜头外有人替它操心，可它用这一天证明，生存从来不是单靠一个标签。`,
    style.closer(animal)
  ].filter(Boolean).join("");
}

function buildAssets(animal, profile) {
  const name = heroName(animal);
  const sceneNames = [...new Set(STAGES.map((stage) => stage.scene))];
  const base = [
    {
      id: "hero-main",
      type: "character",
      name: `${name}主角设定图`,
      approved: false,
      status: "planned",
      prompt: `高清写实动物角色设定图，16:9，主角是${animal}，名字${name}。${profile.look}。同一张图中呈现自然站姿和侧身轮廓，真实野生动物比例，毛发/皮肤纹理清晰，眼神灵动，背景为${profile.habitat}的浅景深环境。无文字，无水印。`
    }
  ];

  const scenes = sceneNames.map((scene, index) => ({
    id: `scene-${String(index + 1).padStart(2, "0")}`,
    type: "scene",
    name: scene,
    approved: false,
    status: "planned",
    prompt: `高清写实自然场景图，16:9，${animal}生活在${profile.habitat}，场景主题：${scene}。画面没有文字，没有人类建筑，光影真实，能作为动物科普视频首帧背景，构图舒展。`
  }));

  const props = [...new Set([...profile.props, ...STAGES.map((stage) => stage.prop).filter(Boolean)])]
    .slice(0, 8)
    .map((prop, index) => ({
      id: `prop-${String(index + 1).padStart(2, "0")}`,
      type: "prop",
      name: prop,
      approved: false,
      status: "planned",
      prompt: `高清写实动物科普道具图，16:9，对象：${prop}，位于${profile.habitat}，自然光，细节清晰，可作为${animal}视频分镜中的道具参考。无文字，无水印。`
    }));

  return [...base, ...scenes, ...props];
}

function assetIdForScene(assets, sceneName) {
  return assets.find((asset) => asset.type === "scene" && asset.name === sceneName)?.id || "scene-01";
}

function assetIdForProp(assets, propName) {
  if (!propName) return "";
  return assets.find((asset) => asset.type === "prop" && asset.name === propName)?.id || "";
}

function cameraMove(index) {
  const moves = ["缓慢推进", "低机位跟随", "轻微环绕", "定镜观察后快速跟随", "由远到近拉近"];
  return moves[index % moves.length];
}

function shotType(index) {
  const shots = ["近景", "中景", "全景", "特写", "跟拍"];
  return shots[index % shots.length];
}

function buildShots(animal, script, assets) {
  const sentences = splitSentences(script);
  return sentences.map((sentence, index) => {
    const stage = STAGES[index % STAGES.length];
    const duration = estimateDuration(sentence, index);
    const sceneAssetId = assetIdForScene(assets, stage.scene);
    const propAssetId = assetIdForProp(assets, stage.prop);
    const assetRefs = ["hero-main", sceneAssetId, propAssetId].filter(Boolean);
    const continuityNote = index === 0
      ? "开场从栖息地全景进入，建立主角生活环境。"
      : `承接上一镜头的${STAGES[(index - 1) % STAGES.length].label}，保持主角外观一致，动作方向从左向右延续。`;
    return {
      id: index + 1,
      status: "planned",
      firstFrameStatus: "planned",
      approvedFirstFrame: false,
      duration,
      stage: stage.label,
      narration: sentence,
      assetRefs,
      heroAssetId: "hero-main",
      sceneAssetId,
      propAssetId,
      continuityNote,
      firstFramePrompt: `高清写实动物科普视频首帧，16:9。沿用主角设定图中的${animal}外观特征，场景为${stage.scene}${stage.prop ? `，包含${stage.prop}` : ""}。画面对应口播：${cleanSentence(sentence)}。构图舒展，主角清晰，真实自然光影，无文字，无水印。`,
      videoPrompt: `基于首帧图生成${duration}秒视频。沿用主角设定图中的${animal}外观特征，保持同一只动物、同一体型、同一毛色/皮肤纹理。动作内容：${cleanSentence(sentence)}。镜头衔接：${continuityNote} 运镜：${cameraMove(index)}，景别：${shotType(index)}。高清写实，16:9，无文字，无水印。`,
      cameraMove: cameraMove(index),
      shotType: shotType(index)
    };
  });
}

function estimateShotDuration(script) {
  return splitSentences(script).reduce((sum, sentence, index) => sum + estimateDuration(sentence, index), 0);
}

function splitVoice(script, maxChars = 240) {
  const sentences = splitSentences(script);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ([...current, ...sentence].length > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((text, index) => ({
    id: index + 1,
    text,
    chars: [...text].length
  }));
}

function buildBriefMarkdown(task) {
  const profile = task.profile;
  const scriptStyle = task.scriptStyle || {
    name: "动物专属叙事",
    promise: "按动物特征调整口吻和节奏"
  };
  const headerLines = [
    `# ${task.animal} 动物科普视频解说方案`,
    "",
    `主角：${task.heroName}`,
    `栖息地：${profile.habitat}`,
    `外观统一描述：${profile.look}`,
    `文案风格：${scriptStyle.name}（${scriptStyle.promise}）`
  ];
  if (task.audience?.name) {
    headerLines.push(`面向人群：${task.audience.name}（${task.audience.note}）`);
  }
  const lines = [
    ...headerLines,
    `口播字数：${task.scriptChars || [...task.script || ""].length} 字，预计配音：约 ${task.estimatedVoiceSeconds || estimateVoiceSeconds(task.script || "")} 秒`,
    `分镜视频总时长：约 ${task.totalDuration} 秒`,
    "",
    "## 核心科学点",
    ...profile.facts.map((fact, index) => `${index + 1}. ${fact}`),
    "",
    "## 故事结构",
    "开场钩子：按动物气质选择轻喜剧、冷吐槽、热血或揭秘角度。",
    "中段冲突：通过觅食、失败、调整路线呈现动物行为，不强行套同一套动作。",
    "科普解释：把身体结构和行为策略嵌入剧情。",
    "结尾收束：保留动物专属情绪和一句有记忆点的收尾。",
    "",
    "## 完整口播稿",
    task.script,
    "",
    "## 镜头衔接原则",
    "- 主角始终沿用同一张角色设定图的外观特征。",
    "- 每个镜头至少绑定主角资产和场景资产。",
    "- 相邻镜头保持动作方向、空间位置或时间推进关系。",
    "- 视频生成前先确认首帧图，不直接批量生成视频。"
  ];
  return lines.join("\n");
}

export function suggestPlanSetup({ animal: requestedAnimal = "" } = {}) {
  const normalized = normalizeAnimalInput(requestedAnimal);
  const animal = normalized.animal;
  const profile = profileFor(animal);
  const recommendedStyle = styleFor(animal, profile);
  const audience = animal === "卡皮巴拉" ? AUDIENCE_LIBRARY.family : AUDIENCE_LIBRARY.general;
  return {
    input: requestedAnimal,
    animal,
    displayName: normalized.displayName,
    matchedAlias: normalized.matchedAlias,
    commonName: animal === "卡皮巴拉" ? "水豚" : animal,
    profile: {
      habitat: profile.habitat,
      personality: profile.personality,
      humor: profile.humor
    },
    recommendedStyleId: recommendedStyle.id,
    recommendedAudienceId: audience.id,
    styleOptions: STYLE_LIBRARY.map((style) => ({
      id: style.id,
      name: style.name,
      promise: style.promise
    })),
    audienceOptions: Object.values(AUDIENCE_LIBRARY),
    summary: `准备生成「${animal}」的动物科普视频，建议使用「${recommendedStyle.name}」，面向「${audience.name}」。`
  };
}

function buildProduction(animal, profile, script) {
  const assets = buildAssets(animal, profile);
  const shots = buildShots(animal, script, assets);
  return {
    assets,
    shots,
    totalDuration: shots.reduce((sum, shot) => sum + shot.duration, 0)
  };
}

export function attachProductionPlan(task) {
  const production = buildProduction(task.animal, task.profile, task.script);
  return {
    ...task,
    ...production,
    briefMarkdown: buildBriefMarkdown({ ...task, ...production })
  };
}

export function attachAssetsPlan(task) {
  const assets = task.assets?.length ? task.assets : buildAssets(task.animal, task.profile);
  const next = { ...task, assets };
  return {
    ...next,
    briefMarkdown: buildBriefMarkdown(next)
  };
}

export function attachShotsPlan(task) {
  const assets = task.assets?.length ? task.assets : buildAssets(task.animal, task.profile);
  const shots = buildShots(task.animal, task.script, assets);
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const next = { ...task, assets, shots, totalDuration };
  return {
    ...next,
    briefMarkdown: buildBriefMarkdown(next)
  };
}

export function createPlan({
  animal: requestedAnimal = "",
  voiceLimit = 240,
  scriptRevision = 0,
  styleId = "",
  audienceId = "general",
  includeProduction = false
} = {}) {
  const normalized = normalizeAnimalInput(requestedAnimal);
  const animal = normalized.animal;
  const baseProfile = profileFor(animal);
  const profile = normalizeProfile(baseProfile);
  const scriptStyle = styleFor(animal, profile, scriptRevision % STYLE_LIBRARY.length, styleId);
  const audience = AUDIENCE_LIBRARY[audienceId] || AUDIENCE_LIBRARY.general;
  const script = buildScript(animal, profile, scriptRevision, scriptStyle.id, audience.id);
  const production = includeProduction ? buildProduction(animal, profile, script) : {
    assets: [],
    shots: [],
    totalDuration: estimateShotDuration(script)
  };
  const task = {
    animal,
    requestedAnimal: normalized.rawInput,
    matchedAlias: normalized.matchedAlias,
    commonName: animal === "卡皮巴拉" ? "水豚" : animal,
    heroName: heroName(animal),
    profile,
    scriptStyle: {
      id: scriptStyle.id,
      name: scriptStyle.name,
      promise: scriptStyle.promise,
      humor: profile.humor
    },
    audience,
    source: "codex-skill",
    scriptApproved: false,
    script,
    scriptRevision,
    scriptChars: [...script].length,
    estimatedVoiceSeconds: estimateVoiceSeconds(script),
    voiceLimit,
    voiceChunks: splitVoice(script, voiceLimit),
    ...production
  };
  return {
    ...task,
    briefMarkdown: buildBriefMarkdown(task)
  };
}

export function refreshTaskStatus(task) {
  if (task.shots?.some((shot) => shot.status === "running" || shot.firstFrameStatus === "running" || shot.compositionStatus === "running") || task.assets?.some((asset) => asset.status === "running")) {
    task.status = "running";
  } else if (task.shots?.some((shot) => shot.status === "failed" || shot.firstFrameStatus === "failed" || shot.compositionStatus === "failed") || task.assets?.some((asset) => asset.status === "failed")) {
    task.status = "partial";
  } else if (task.shots?.length && task.shots.every((shot) => shot.status === "done")) {
    task.status = "done";
  } else if (task.scriptApproved || task.assets?.some((asset) => asset.approved) || task.shots?.some((shot) => shot.status === "done")) {
    task.status = "in_progress";
  } else {
    task.status = "draft";
  }
}

export async function saveTask(baseDir, task) {
  await fs.mkdir(task.dir, { recursive: true });
  await fs.mkdir(path.join(task.dir, "videos"), { recursive: true });
  await fs.mkdir(path.join(task.dir, "images"), { recursive: true });
  if (task.version) {
    await fs.writeFile(path.join(task.dir, "manifest.json"), JSON.stringify(task, null, 2));
    if (task.directionMarkdown) await fs.writeFile(path.join(task.dir, "方向确认.md"), task.directionMarkdown);
    if (task.briefMarkdown || task.script) await fs.writeFile(path.join(task.dir, "解说方案.md"), task.briefMarkdown || buildBriefMarkdown(task));
    if (task.script) await fs.writeFile(path.join(task.dir, "口播文案.txt"), task.script);
    if (task.voiceChunks?.length) await fs.writeFile(path.join(task.dir, "voice.json"), JSON.stringify(task.voiceChunks, null, 2));
    if (task.assets?.length) await fs.writeFile(path.join(task.dir, "assets.json"), JSON.stringify(task.assets, null, 2));
    if (task.shots?.length) await fs.writeFile(path.join(task.dir, "shots.json"), JSON.stringify(task.shots, null, 2));
    if (task.shots?.length || task.voiceChunks?.length) await fs.writeFile(path.join(task.dir, "剪映导入清单.md"), buildCapCutList(task));
    return;
  }
  await fs.writeFile(path.join(task.dir, "task.json"), JSON.stringify(task, null, 2));
  await fs.writeFile(path.join(task.dir, "解说方案.md"), task.briefMarkdown || buildBriefMarkdown(task));
  await fs.writeFile(path.join(task.dir, "assets.json"), JSON.stringify(task.assets, null, 2));
  await fs.writeFile(path.join(task.dir, "shots.json"), JSON.stringify(task.shots, null, 2));
  await fs.writeFile(path.join(task.dir, "voice.json"), JSON.stringify(task.voiceChunks, null, 2));
  await fs.writeFile(path.join(task.dir, "口播文案.txt"), task.script);
  await fs.writeFile(path.join(task.dir, "剪映导入清单.md"), buildCapCutList(task));
}

function buildCapCutList(task) {
  const lines = [
    `# ${task.animal} 动物科普视频剪映导入清单`,
    "",
    `预计总时长：${task.totalDuration} 秒`,
    "",
    "## 生成闸门",
    `- 解说方案确认：${task.scriptApproved ? "已确认" : "未确认"}`,
    "- 图片资产需逐个确认后，再生成对应首帧和视频。",
    "",
    "## 视频片段顺序",
    ""
  ];
  for (const shot of task.shots || []) {
    lines.push(`${shot.id}. ${String(shot.id).padStart(2, "0")}.mp4 - ${shot.duration}秒 - ${shot.narration}`);
    lines.push(`   - 资产：${shot.assetRefs.join(", ")}`);
    lines.push(`   - 衔接：${shot.continuityNote}`);
  }
  lines.push("", "## 配音文案");
  for (const chunk of task.voiceChunks || []) {
    lines.push("", `### 配音 ${chunk.id}（${chunk.chars} 字）`, chunk.text);
  }
  return lines.join("\n");
}

function versionTaskId(animal, version) {
  return `v__${encodeURIComponent(animal)}__${encodeURIComponent(version)}`;
}

function manifestSummary(task) {
  return {
    id: task.id || (task.animal && task.version ? versionTaskId(task.animal, task.version) : ""),
    animal: task.animal,
    version: task.version || "",
    createdAt: task.createdAt,
    status: task.status,
    totalDuration: task.totalDuration || 0,
    scriptApproved: Boolean(task.scriptApproved),
    assetCount: task.assets?.length || 0,
    approvedAssetCount: task.assets?.filter((asset) => asset.approved).length || 0,
    dir: task.dir,
    taskType: task.version ? "version" : "legacy"
  };
}

export async function loadTasks(tasksDir) {
  await fs.mkdir(tasksDir, { recursive: true });
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const animalDir = path.join(tasksDir, entry.name);
    try {
      const versionEntries = await fs.readdir(path.join(animalDir, "versions"), { withFileTypes: true });
      for (const versionEntry of versionEntries) {
        if (!versionEntry.isDirectory() || versionEntry.name.startsWith(".")) continue;
        try {
          const raw = await fs.readFile(path.join(animalDir, "versions", versionEntry.name, "manifest.json"), "utf8");
          const task = JSON.parse(raw);
          tasks.push(manifestSummary(task));
        } catch {
          // Ignore incomplete version folders.
        }
      }
      continue;
    } catch {
      // Not a new animal-version folder; try legacy below.
    }
    try {
      const raw = await fs.readFile(path.join(animalDir, "task.json"), "utf8");
      const task = JSON.parse(raw);
      tasks.push(manifestSummary(task));
    } catch {
      // Ignore incomplete task folders.
    }
  }
  return tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
