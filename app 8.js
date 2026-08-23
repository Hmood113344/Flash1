// ══════════════════════════════════════════════════════════════════════════
// فلاش — نظام مخالفات وزارة الداخلية (ملف واحد شامل: إعدادات + موقع + بوت)
// ══════════════════════════════════════════════════════════════════════════

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const mongoose = require("mongoose");
const {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

// ══════════════════════════════════════════════════════════════════════════
// 1) الإعدادات — تُقرأ من Environment Variables بلوحة الاستضافة (Render → Environment)
// ══════════════════════════════════════════════════════════════════════════
const CONFIG = {
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || "",
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || "",
    DISCORD_CALLBACK_URL: process.env.DISCORD_CALLBACK_URL || "https://your-site.onrender.com/auth/discord/callback",
    BOT_TOKEN: process.env.BOT_TOKEN || "",
    GUILD_ID: process.env.GUILD_ID || "",
    MONGO_URI: process.env.MONGO_URI || "",

    SITE_NAME: "فلاش",
    SESSION_SECRET: process.env.SESSION_SECRET || "غيّر_هذا_السر_MOI_2026",
    PORT: process.env.PORT || 7700,

    // رتب العسكر المعتمدة لتسجيل الدخول (قابلة للزيادة)
    MILITARY_ROLE_IDS: [
        "1500064443537686588",
        "1500064767082233926",
        "1533192878510178304",
    ],

    VIOLATION_TYPES: [
        "تجاوز السرعة المحددة",
        "قطع الإشارة الحمراء",
        "الوقوف الخاطئ / التعدي على الرصيف",
        "عدم ربط حزام الأمان",
        "استخدام الجوال أثناء القيادة",
        "القيادة العكسية",
        "تجاوز في مكان ممنوع",
        "عدم وجود لوحات / لوحات غير واضحة",
        "التفحيط / القيادة المتهورة",
        "عدم الالتزام بالمسار",
        "الدخول لمنطقة محظورة",
        "الهروب من نقطة تفتيش",
    ],

    POINTS_ON_APPROVE: 2,
    POINTS_ON_REJECT: 1,
    MAX_VEHICLES_ADD: 60,
};

// ══════════════════════════════════════════════════════════════════════════
// 2) قاعدة البيانات والموديلات
// ══════════════════════════════════════════════════════════════════════════
mongoose.connect(CONFIG.MONGO_URI)
    .then(() => console.log("✅ MOI MongoDB connected"))
    .catch(err => console.log("❌ MongoDB error:", err));

const PersonnelSchema = new mongoose.Schema({
    discord: { type: String, required: true, unique: true },
    discordTag: String,
    registeredName: { type: String, default: null },
    unit: { type: String, default: null },
    rank: { type: String, default: "فرد" },
    points: { type: Number, default: 0 },
    notes: [{
        text: String, addedBy: String, addedByTag: String,
        createdAt: { type: Date, default: Date.now }
    }],
    isBlocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Personnel = mongoose.model("Personnel", PersonnelSchema);

const ViolationSchema = new mongoose.Schema({
    reporterDiscord: String,
    reporterTag: String,
    reporterName: String,
    reporterUnit: String,
    violationType: String,
    vehicle: String,
    plateNumber: String,
    status: { type: String, default: "pending" },
    rejectReason: { type: String, default: null },
    reviewedBy: String,
    reviewedByTag: String,
    reviewedAt: Date,
    createdAt: { type: Date, default: Date.now }
});
const Violation = mongoose.model("Violation", ViolationSchema);

const VehicleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    addedBy: String,
    createdAt: { type: Date, default: Date.now }
});
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

const SettingsSchema = new mongoose.Schema({
    isMaintenance: { type: Boolean, default: false },
    disableLogin: { type: Boolean, default: false },
    disableViolations: { type: Boolean, default: false },
    adminList: { type: [String], default: [] },
    commandRoles: {
        patrolCommander: String,
        patrolDeputy: String,
        roadSecurityCommander: String,
        roadSecurityDeputy: String,
        antiDrugsCommander: String,
        antiDrugsDeputy: String,
        management: String,
    },
    violationsChannelId: String,
}, { minimize: false });
const Settings = mongoose.model("Settings", SettingsSchema);

async function getSettings() {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    return s;
}

function generatePlate() {
    const letters = "أبجدهوزحطيكلمنسعفصقرشتثخذضظغ";
    const pick = () => letters[Math.floor(Math.random() * letters.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${pick()} ${pick()} ${pick()} - ${num}`;
}

// ══════════════════════════════════════════════════════════════════════════
// 3) بوت الديسكورد — يسجّل دخول أول شي، ونستخدم نفس عميله للتحقق من الرتب
//    (بدل طلب HTTP يدوي منفصل ممكن يفشل بمشاكل توكن/شبكة)
// ══════════════════════════════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

const pendingMessages = new Map(); // violationId -> { channelId, messageId }
let botReady = false;

async function isSeniorAdmin(userId) {
    const settings = await getSettings();
    return settings.adminList.includes(userId);
}

async function hasCommandRole(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const settings = await getSettings();
    const roles = Object.values(settings.commandRoles || {}).filter(Boolean);
    return roles.some(r => member.roles.cache.has(r));
}

// تحقق الرتبة العسكرية عن طريق عميل البوت المسجّل دخوله فعلياً (أدق وأثبت من fetch يدوي)
async function isMilitary(discordId) {
    if (!botReady) return { ok: false, reason: "البوت لسا ما اتصل بديسكورد، حاول بعد ثوانٍ" };
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(discordId);
        const has = member.roles.cache.some(r => CONFIG.MILITARY_ROLE_IDS.includes(r.id));
        return { ok: has, member };
    } catch (e) {
        console.error("❌ isMilitary خطأ:", e.message);
        return { ok: false, reason: e.message };
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName("تسطيب-النظام")
        .setDescription("إعداد رتب القيادة الأساسية للنظام (للإدارة فقط)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(o => o.setName("قائد_الدوريات").setDescription("رول قائد الدوريات").setRequired(true))
        .addRoleOption(o => o.setName("نائب_قائد_الدوريات").setDescription("رول نائب قائد الدوريات").setRequired(true))
        .addRoleOption(o => o.setName("قائد_امن_الطرق").setDescription("رول قائد أمن الطرق").setRequired(true))
        .addRoleOption(o => o.setName("نائب_قائد_امن_الطرق").setDescription("رول نائب قائد أمن الطرق").setRequired(true))
        .addRoleOption(o => o.setName("قائد_مكافحة_المخدرات").setDescription("رول قائد مكافحة المخدرات").setRequired(true))
        .addRoleOption(o => o.setName("نائب_قائد_مكافحة_المخدرات").setDescription("رول نائب قائد مكافحة المخدرات").setRequired(true))
        .addRoleOption(o => o.setName("رتبة_الاداره").setDescription("رول الإدارة العليا").setRequired(true)),

    new SlashCommandBuilder()
        .setName("قبول-المخالفات")
        .setDescription("عرض المخالفات المعلّقة لقبولها أو رفضها (للإدارة فقط)"),

    new SlashCommandBuilder()
        .setName("لوحة-القيادة")
        .setDescription("أوامر القيادة العسكرية")
        .addSubcommand(s => s
            .setName("تعيين-يونت")
            .setDescription("تعيين يونت ورتبة لعسكري")
            .addUserOption(o => o.setName("العسكري").setDescription("العسكري المستهدف").setRequired(true))
            .addStringOption(o => o.setName("اليونت").setDescription("اسم اليونت").setRequired(true))
            .addStringOption(o => o.setName("الرتبة").setDescription("الرتبة (اختياري)").setRequired(false)))
        .addSubcommand(s => s
            .setName("عرض-ملف")
            .setDescription("عرض ملف عسكري")
            .addUserOption(o => o.setName("العسكري").setDescription("العسكري المستهدف").setRequired(true)))
        .addSubcommand(s => s
            .setName("تعديل-نقاط")
            .setDescription("إضافة أو خصم نقاط من عسكري")
            .addUserOption(o => o.setName("العسكري").setDescription("العسكري المستهدف").setRequired(true))
            .addIntegerOption(o => o.setName("العدد").setDescription("موجب للإضافة، سالب للخصم").setRequired(true))),
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(CONFIG.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: commands });
        console.log("✅ تم تسجيل أوامر السلاش");
    } catch (e) {
        console.log("❌ خطأ بتسجيل الأوامر:", e);
    }
}

function buildViolationEmbed(v) {
    return new EmbedBuilder()
        .setTitle("🚨 مخالفة جديدة بانتظار المراجعة")
        .setColor(0xf59e0b)
        .addFields(
            { name: "اسم العسكري", value: v.reporterName || "-", inline: true },
            { name: "اليونت", value: v.reporterUnit || "-", inline: true },
            { name: "نوع المخالفة", value: v.violationType, inline: false },
            { name: "المركبة", value: v.vehicle, inline: true },
            { name: "لوحة السيارة", value: v.plateNumber, inline: true },
        )
        .setFooter({ text: `ID: ${v._id}` })
        .setTimestamp(v.createdAt);
}

function buildViolationButtons(id, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${id}`).setLabel("قبول").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`reject_${id}`).setLabel("رفض").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
}

client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === "تسطيب-النظام") {
            const settings = await getSettings();
            settings.commandRoles = {
                patrolCommander: interaction.options.getRole("قائد_الدوريات").id,
                patrolDeputy: interaction.options.getRole("نائب_قائد_الدوريات").id,
                roadSecurityCommander: interaction.options.getRole("قائد_امن_الطرق").id,
                roadSecurityDeputy: interaction.options.getRole("نائب_قائد_امن_الطرق").id,
                antiDrugsCommander: interaction.options.getRole("قائد_مكافحة_المخدرات").id,
                antiDrugsDeputy: interaction.options.getRole("نائب_قائد_مكافحة_المخدرات").id,
                management: interaction.options.getRole("رتبة_الاداره").id,
            };
            await settings.save();
            return interaction.reply({ content: "✅ تم تسطيب النظام وحفظ رتب القيادة بنجاح.", ephemeral: true });
        }

        if (commandName === "قبول-المخالفات") {
            const senior = await isSeniorAdmin(interaction.user.id);
            const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
            if (!senior && !isAdmin) {
                return interaction.reply({ content: "🚫 ما تملك صلاحية استخدام هذا الأمر.", ephemeral: true });
            }
            const list = await Violation.find({ status: "pending" }).sort({ createdAt: 1 });
            if (list.length === 0) {
                return interaction.reply({ content: "لا توجد مخالفات معلّقة حالياً.", ephemeral: true });
            }
            await interaction.reply({ content: `📋 يوجد ${list.length} مخالفة معلّقة:`, ephemeral: true });
            for (const v of list) {
                const msg = await interaction.channel.send({
                    embeds: [buildViolationEmbed(v)],
                    components: [buildViolationButtons(v._id.toString())],
                });
                pendingMessages.set(v._id.toString(), { channelId: msg.channelId, messageId: msg.id });
            }
            return;
        }

        if (commandName === "لوحة-القيادة") {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const allowed = await hasCommandRole(member);
            if (!allowed) {
                return interaction.reply({ content: "🚫 هذا الأمر مخصص للقيادة العسكرية فقط.", ephemeral: true });
            }
            const sub = interaction.options.getSubcommand();
            const target = interaction.options.getUser("العسكري");

            if (sub === "تعيين-يونت") {
                const unit = interaction.options.getString("اليونت");
                const rank = interaction.options.getString("الرتبة");
                const update = { unit };
                if (rank) update.rank = rank;
                const p = await Personnel.findOneAndUpdate(
                    { discord: target.id },
                    { $set: update, $setOnInsert: { discordTag: target.username } },
                    { new: true, upsert: true }
                );
                return interaction.reply({ content: `✅ تم تعيين <@${target.id}> إلى يونت **${p.unit}**${rank ? ` برتبة **${p.rank}**` : ""}.` });
            }
            if (sub === "عرض-ملف") {
                const p = await Personnel.findOne({ discord: target.id });
                if (!p) return interaction.reply({ content: "لا يوجد ملف لهذا العضو بعد.", ephemeral: true });
                const embed = new EmbedBuilder()
                    .setTitle(`ملف: ${p.registeredName || target.username}`)
                    .setColor(0x2563eb)
                    .addFields(
                        { name: "اليونت", value: p.unit || "-", inline: true },
                        { name: "الرتبة", value: p.rank || "-", inline: true },
                        { name: "النقاط", value: String(p.points), inline: true },
                        { name: "الحالة", value: p.isBlocked ? "🚫 موقوف" : "✅ فعّال", inline: true },
                    );
                return interaction.reply({ embeds: [embed] });
            }
            if (sub === "تعديل-نقاط") {
                const amount = interaction.options.getInteger("العدد");
                const p = await Personnel.findOneAndUpdate(
                    { discord: target.id },
                    { $inc: { points: amount }, $setOnInsert: { discordTag: target.username } },
                    { new: true, upsert: true }
                );
                return interaction.reply({ content: `✅ تم تعديل نقاط <@${target.id}>. النقاط الحالية: **${p.points}**` });
            }
        }
        return;
    }

    if (interaction.isButton()) {
        const [action, id] = interaction.customId.split("_");
        if (action !== "approve" && action !== "reject") return;

        const senior = await isSeniorAdmin(interaction.user.id);
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!senior && !isAdmin) {
            return interaction.reply({ content: "🚫 ما تملك صلاحية.", ephemeral: true });
        }
        const v = await Violation.findById(id);
        if (!v || v.status !== "pending") {
            return interaction.reply({ content: "هذه المخالفة تمت مراجعتها مسبقاً.", ephemeral: true });
        }
        if (action === "approve") {
            v.status = "approved";
            v.reviewedBy = interaction.user.id;
            v.reviewedByTag = interaction.user.username;
            v.reviewedAt = new Date();
            await v.save();
            await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: CONFIG.POINTS_ON_APPROVE } });
            const embed = buildViolationEmbed(v).setColor(0x22c55e).setTitle("✅ مخالفة مقبولة");
            await interaction.update({ embeds: [embed], components: [buildViolationButtons(id, true)] });
            pendingMessages.delete(id);
            return;
        }
        if (action === "reject") {
            const modal = new ModalBuilder().setCustomId(`rejectmodal_${id}`).setTitle("سبب الرفض");
            const input = new TextInputBuilder()
                .setCustomId("reason").setLabel("اكتب سبب رفض المخالفة")
                .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("rejectmodal_")) {
        const id = interaction.customId.split("_")[1];
        const reason = interaction.fields.getTextInputValue("reason");
        const v = await Violation.findById(id);
        if (!v || v.status !== "pending") {
            return interaction.reply({ content: "هذه المخالفة تمت مراجعتها مسبقاً.", ephemeral: true });
        }
        v.status = "rejected";
        v.rejectReason = reason;
        v.reviewedBy = interaction.user.id;
        v.reviewedByTag = interaction.user.username;
        v.reviewedAt = new Date();
        await v.save();
        await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: CONFIG.POINTS_ON_REJECT } });

        const ref = pendingMessages.get(id);
        if (ref) {
            try {
                const channel = await client.channels.fetch(ref.channelId);
                const msg = await channel.messages.fetch(ref.messageId);
                const embed = buildViolationEmbed(v).setColor(0xef4444).setTitle("❌ مخالفة مرفوضة");
                await msg.edit({ embeds: [embed], components: [buildViolationButtons(id, true)] });
            } catch (e) { /* تجاهل */ }
        }
        pendingMessages.delete(id);
        return interaction.reply({ content: "✅ تم رفض المخالفة وحفظ السبب.", ephemeral: true });
    }
});

const activeVehicleSessions = new Set();
client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith("-")) return;
    const [cmd] = message.content.slice(1).trim().split(/\s+/);
    if (cmd !== "مركبات") return;

    const senior = await isSeniorAdmin(message.author.id);
    if (!senior) return;
    if (activeVehicleSessions.has(message.author.id)) {
        return message.reply("عندك جلسة إضافة مركبات شغالة حالياً، أكملها أول.");
    }
    activeVehicleSessions.add(message.author.id);
    const filter = m => m.author.id === message.author.id;
    try {
        await message.reply(`كم عدد المركبات اللي تبي تضيفها؟ (الأقصى ${CONFIG.MAX_VEHICLES_ADD})`);
        const countCollected = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
        const countMsg = countCollected.first();
        const count = parseInt(countMsg.content.trim());
        if (isNaN(count) || count < 1 || count > CONFIG.MAX_VEHICLES_ADD) {
            activeVehicleSessions.delete(message.author.id);
            return message.reply(`❌ الرقم غير صحيح. لازم يكون بين 1 و ${CONFIG.MAX_VEHICLES_ADD}.`);
        }
        countMsg.delete().catch(() => {});
        const added = [];
        for (let i = 1; i <= count; i++) {
            const prompt = await message.channel.send(`🚗 اكتب اسم المركبة رقم ${i} من ${count}:`);
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
            const nameMsg = collected.first();
            const name = nameMsg.content.trim();
            nameMsg.delete().catch(() => {});
            prompt.delete().catch(() => {});
            if (!name) { i--; continue; }
            try {
                await Vehicle.create({ name, addedBy: message.author.id });
                added.push(name);
            } catch (e) {
                await message.channel.send(`⚠️ المركبة "${name}" موجودة مسبقاً، تم تجاوزها.`);
            }
        }
        await message.channel.send(`✅ تم إضافة ${added.length} مركبة:\n${added.map(n => `• ${n}`).join("\n") || "لا شيء"}`);
    } catch (e) {
        await message.channel.send("⏱️ انتهى الوقت، تم إلغاء العملية.");
    } finally {
        activeVehicleSessions.delete(message.author.id);
    }
});

client.once("ready", async () => {
    console.log(`🤖 البوت شغال: ${client.user.tag}`);
    botReady = true;
    await registerCommands();
});

if (CONFIG.BOT_TOKEN) {
    client.login(CONFIG.BOT_TOKEN).catch(e => console.log("❌ فشل تسجيل دخول البوت:", e.message));
} else {
    console.log("⚠️ BOT_TOKEN غير موجود — البوت لن يعمل، تحقق من الوقت متغيرات البيئة");
}

// ══════════════════════════════════════════════════════════════════════════
// 4) موقع الويب (Express)
// ══════════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());
app.use(session({ secret: CONFIG.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CONFIG.DISCORD_CLIENT_ID,
    clientSecret: CONFIG.DISCORD_CLIENT_SECRET,
    callbackURL: CONFIG.DISCORD_CALLBACK_URL,
    scope: ["identify", "guilds.members.read"],
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/" }), (req, res) => res.redirect("/"));
app.get("/auth/logout", (req, res) => { req.logout(() => res.redirect("/")); });

function ensureAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: "غير مسجّل دخول" });
}

app.get("/api/me", ensureAuth, async (req, res) => {
    const settings = await getSettings();
    if (settings.disableLogin) {
        return res.json({ blocked: true, reason: "الدخول مغلق حالياً من قبل الإدارة" });
    }
    const check = await isMilitary(req.user.id);
    if (!check.ok) {
        return res.json({ blocked: true, reason: "هذا الموقع مخصص لمنسوبي الجهات العسكرية فقط" });
    }

    let p = await Personnel.findOne({ discord: req.user.id });
    if (!p) p = await Personnel.create({ discord: req.user.id, discordTag: req.user.username });

    const isAdmin = settings.adminList.includes(req.user.id);
    res.json({
        blocked: false,
        discordId: req.user.id,
        discordTag: req.user.username,
        avatar: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : null,
        registeredName: p.registeredName,
        unit: p.unit,
        rank: p.rank,
        points: p.points,
        notes: p.notes,
        isBlocked: p.isBlocked,
        isAdmin,
        maintenance: settings.isMaintenance,
        violationsDisabled: settings.disableViolations,
    });
});

app.post("/api/profile/setup", ensureAuth, async (req, res) => {
    const { name, unit } = req.body;
    if (!name || !unit) return res.status(400).json({ error: "أكمل الاسم واليونت" });
    const p = await Personnel.findOneAndUpdate(
        { discord: req.user.id }, { registeredName: name, unit }, { new: true, upsert: true }
    );
    res.json({ ok: true, registeredName: p.registeredName, unit: p.unit });
});

app.get("/api/violations/meta", ensureAuth, async (req, res) => {
    const vehicles = await Vehicle.find().sort({ name: 1 });
    res.json({ types: CONFIG.VIOLATION_TYPES, vehicles: vehicles.map(v => v.name) });
});

app.post("/api/violations/submit", ensureAuth, async (req, res) => {
    const settings = await getSettings();
    if (settings.disableViolations) return res.status(403).json({ error: "تسجيل المخالفات مغلق حالياً" });
    const p = await Personnel.findOne({ discord: req.user.id });
    if (!p || !p.registeredName || !p.unit) return res.status(400).json({ error: "أكمل بياناتك (الاسم واليونت) أولاً" });
    if (p.isBlocked) return res.status(403).json({ error: "أنت موقوف عن تسجيل مخالفات جديدة" });
    const { violationType, vehicle } = req.body;
    if (!violationType || !vehicle) return res.status(400).json({ error: "أكمل نوع المخالفة والمركبة" });

    const v = await Violation.create({
        reporterDiscord: req.user.id, reporterTag: req.user.username,
        reporterName: p.registeredName, reporterUnit: p.unit,
        violationType, vehicle, plateNumber: generatePlate(), status: "pending",
    });
    res.json({ ok: true, violation: v });
});

app.get("/api/violations/mine", ensureAuth, async (req, res) => {
    const list = await Violation.find({ reporterDiscord: req.user.id }).sort({ createdAt: -1 });
    res.json({ list });
});

async function ensureAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    const settings = await getSettings();
    if (!settings.adminList.includes(req.user.id)) return res.status(403).json({ error: "ليست لديك صلاحية" });
    req.settings = settings;
    next();
}

app.get("/api/admin/pending", ensureAdmin, async (req, res) => {
    const list = await Violation.find({ status: "pending" }).sort({ createdAt: 1 });
    res.json({ list });
});

app.get("/api/admin/settings", ensureAdmin, async (req, res) => { res.json({ settings: req.settings }); });

app.post("/api/admin/settings", ensureAdmin, async (req, res) => {
    const { isMaintenance, disableLogin, disableViolations } = req.body;
    const s = req.settings;
    if (typeof isMaintenance === "boolean") s.isMaintenance = isMaintenance;
    if (typeof disableLogin === "boolean") s.disableLogin = disableLogin;
    if (typeof disableViolations === "boolean") s.disableViolations = disableViolations;
    await s.save();
    res.json({ ok: true });
});

app.post("/api/admin/violations/:id/approve", ensureAdmin, async (req, res) => {
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    v.status = "approved"; v.reviewedBy = req.user.id; v.reviewedByTag = req.user.username; v.reviewedAt = new Date();
    await v.save();
    await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: CONFIG.POINTS_ON_APPROVE } });
    res.json({ ok: true });
});

app.post("/api/admin/violations/:id/reject", ensureAdmin, async (req, res) => {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "لازم تكتب سبب الرفض" });
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    v.status = "rejected"; v.rejectReason = reason.trim();
    v.reviewedBy = req.user.id; v.reviewedByTag = req.user.username; v.reviewedAt = new Date();
    await v.save();
    await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: CONFIG.POINTS_ON_REJECT } });
    res.json({ ok: true });
});

app.get("/api/admin/personnel", ensureAdmin, async (req, res) => {
    const q = (req.query.q || "").trim();
    const filter = q ? { $or: [{ registeredName: new RegExp(q, "i") }, { unit: new RegExp(q, "i") }, { discordTag: new RegExp(q, "i") }] } : {};
    const list = await Personnel.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ list });
});

app.post("/api/admin/personnel/:discord/note", ensureAdmin, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "اكتب الملاحظة" });
    const p = await Personnel.findOneAndUpdate(
        { discord: req.params.discord },
        { $push: { notes: { text: text.trim(), addedBy: req.user.id, addedByTag: req.user.username } } },
        { new: true }
    );
    if (!p) return res.status(404).json({ error: "غير موجود" });
    res.json({ ok: true, notes: p.notes });
});

app.post("/api/admin/personnel/:discord/block", ensureAdmin, async (req, res) => {
    const { blocked } = req.body;
    const p = await Personnel.findOneAndUpdate({ discord: req.params.discord }, { isBlocked: !!blocked }, { new: true });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    res.json({ ok: true, isBlocked: p.isBlocked });
});

// ══════════════════════════════════════════════════════════════════════════
// 5) الواجهة (صفحة واحدة SPA)
// ══════════════════════════════════════════════════════════════════════════
app.get("/", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${CONFIG.SITE_NAME}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Tahoma', 'Segoe UI', sans-serif; }
    body { background: linear-gradient(160deg, #050f1e 0%, #0a1930 100%); color: #e2e8f0; min-height: 100vh; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 24px 16px; }
    .card { background: rgba(15,25,45,0.85); border: 1px solid rgba(59,130,246,0.25); border-radius: 14px; padding: 20px; margin-bottom: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.35); }
    h1, h2, h3 { color: #60a5fa; margin-bottom: 12px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border: none; border-radius: 10px; padding: 12px 22px; font-size: 15px; cursor: pointer; transition: 0.2s; }
    .btn:hover { filter: brightness(1.15); }
    .btn.danger { background: linear-gradient(135deg, #dc2626, #991b1b); }
    .btn.gray { background: #334155; }
    .btn.sm { padding: 7px 14px; font-size: 13px; }
    input, select, textarea { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(59,130,246,0.3); background: rgba(5,15,30,0.9); color: #fff; margin-bottom: 10px; font-size: 14px; }
    label { display: block; margin-bottom: 6px; color: #93c5fd; font-size: 13px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .badge.pending { background: #78350f; color: #fbbf24; }
    .badge.approved { background: #064e3b; color: #34d399; }
    .badge.rejected { background: #4c0519; color: #fb7185; }
    .stat { text-align: center; padding: 14px; background: rgba(5,15,30,0.6); border-radius: 10px; }
    .stat .num { font-size: 26px; font-weight: bold; color: #60a5fa; }
    .stat .lbl { font-size: 12px; color: #94a3b8; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .center { text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border-bottom: 1px solid rgba(59,130,246,0.15); text-align: right; }
    .avatar { width: 70px; height: 70px; border-radius: 50%; border: 3px solid #2563eb; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .tab { padding: 8px 16px; border-radius: 8px; background: #1e293b; cursor: pointer; font-size: 13px; }
    .tab.active { background: #2563eb; }
    .id-card { background: linear-gradient(135deg, #0f172a, #1e3a5f); border: 2px solid #3b82f6; border-radius: 16px; padding: 20px; max-width: 380px; margin: 0 auto; }
    .hidden { display: none !important; }
    #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #1e293b; padding: 10px 20px; border-radius: 10px; border: 1px solid #3b82f6; z-index: 999; display: none; }
    footer { text-align: center; padding: 1.5rem; margin-top: 2rem; border-top: 1px solid rgba(59,130,246,0.2); background: rgba(5,15,30,0.8); color: #475569; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="wrap" id="app"><div class="card center">جارِ التحميل...</div></div>
<div id="toast"></div>
<footer><p>جميع الحقوق محفوظة © 2026 | <span style="color:#3b82f6;font-weight:bold;">${CONFIG.SITE_NAME} — نظام مخالفات لمهيدي و اصدقائه</span></p></footer>

<script>
let ME = null;
async function api(url, opts) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'خطأ');
    return data;
}
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2500);
}
async function init() {
    try { ME = await api('/api/me'); } catch (e) { renderLogin(); return; }
    if (ME.blocked) { renderBlocked(ME.reason); return; }
    if (!ME.registeredName || !ME.unit) { renderSetup(); return; }
    renderDashboard();
}
function renderLogin() {
    document.getElementById('app').innerHTML = \`
        <div class="card center" style="margin-top:60px;">
            <h1>${CONFIG.SITE_NAME}</h1>
            <p style="color:#94a3b8;margin-bottom:24px;">نظام تسجيل المخالفات لمنسوبي الجهات العسكرية</p>
            <a href="/auth/discord" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#5b6cf5;color:#fff;font-weight:bold;font-size:17px;padding:16px 34px;border-radius:999px;text-decoration:none;box-shadow:0 6px 18px rgba(91,108,245,0.45);">
                <span>🔒</span><span>تسجيل الدخول عبر ديسكورد</span>
            </a>
        </div>\`;
}
function renderBlocked(reason) {
    document.getElementById('app').innerHTML = \`
        <div class="card center" style="margin-top:60px;">
            <h2 style="color:#fb7185;">🚫 غير مصرح</h2>
            <p style="color:#94a3b8;margin-top:10px;">\${reason}</p>
            <a class="btn gray" href="/auth/logout" style="margin-top:16px;">تسجيل خروج</a>
        </div>\`;
}
function renderSetup() {
    document.getElementById('app').innerHTML = \`
        <div class="card" style="margin-top:40px;">
            <h2>أكمل بياناتك العسكرية</h2>
            <label>الاسم المسجل في السيرفر</label>
            <input id="setup-name" placeholder="مثال: عبدالله الحربي">
            <label>اليونت العسكري</label>
            <input id="setup-unit" placeholder="مثال: الدورية الأولى">
            <button class="btn" onclick="doSetup()">حفظ ومتابعة</button>
        </div>\`;
}
async function doSetup() {
    const name = document.getElementById('setup-name').value.trim();
    const unit = document.getElementById('setup-unit').value.trim();
    if (!name || !unit) return toast('أكمل الحقول');
    try { await api('/api/profile/setup', { method: 'POST', body: JSON.stringify({ name, unit }) }); init(); }
    catch (e) { toast(e.message); }
}
function renderDashboard() {
    document.getElementById('app').innerHTML = \`
        <div class="card row">
            <div class="row" style="gap:14px;">
                \${ME.avatar ? \`<img class="avatar" src="\${ME.avatar}">\` : ''}
                <div><h2 style="margin-bottom:2px;">\${ME.registeredName}</h2><div style="color:#94a3b8;font-size:13px;">\${ME.unit} • \${ME.rank}</div></div>
            </div>
            <div class="row" style="gap:8px;">
                \${ME.isAdmin ? '<button class="btn gray sm" onclick="renderAdmin()">لوحة الإدارة</button>' : ''}
                <a class="btn gray sm" href="/auth/logout">خروج</a>
            </div>
        </div>
        \${ME.maintenance ? '<div class="card" style="border-color:#f59e0b;color:#fbbf24;">⚠️ الموقع في وضع الصيانة حالياً</div>' : ''}
        <div class="grid3">
            <div class="stat"><div class="num">\${ME.points}</div><div class="lbl">النقاط</div></div>
            <div class="stat"><div class="num" id="mine-count">-</div><div class="lbl">مخالفاتي</div></div>
            <div class="stat"><div class="num">\${ME.isBlocked ? '🚫' : '✅'}</div><div class="lbl">الحالة</div></div>
        </div>
        <div class="card">
            <div class="row">
                <h3>مخالفاتي المسجلة</h3>
                <div class="row" style="gap:8px;">
                    <button class="btn sm" onclick="renderCard()">بطاقتي</button>
                    \${!ME.violationsDisabled ? '<button class="btn sm" onclick="renderNewViolation()">+ تسجيل مخالفة جديدة</button>' : ''}
                </div>
            </div>
            <div id="notes-box" style="margin:10px 0;"></div>
            <div id="mine-list">جارِ التحميل...</div>
        </div>
    \`;
    loadMine();
    renderNotes();
}
function renderNotes() {
    const box = document.getElementById('notes-box');
    if (!ME.notes || ME.notes.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="font-size:13px;color:#93c5fd;margin-bottom:6px;">ملاحظات عليك:</div>' +
        ME.notes.map(n => \`<div style="background:rgba(5,15,30,0.6);padding:8px;border-radius:8px;margin-bottom:6px;font-size:13px;">\${n.text}</div>\`).join('');
}
async function loadMine() {
    const { list } = await api('/api/violations/mine');
    document.getElementById('mine-count').textContent = list.length;
    const box = document.getElementById('mine-list');
    if (list.length === 0) { box.innerHTML = '<p style="color:#64748b;">لا توجد مخالفات مسجلة بعد</p>'; return; }
    box.innerHTML = \`<table><tr><th>النوع</th><th>المركبة</th><th>اللوحة</th><th>الحالة</th></tr>\` +
        list.map(v => \`<tr><td>\${v.violationType}</td><td>\${v.vehicle}</td><td>\${v.plateNumber}</td><td><span class="badge \${v.status}">\${v.status === 'pending' ? 'قيد المراجعة' : v.status === 'approved' ? 'مقبولة' : 'مرفوضة'}</span></td></tr>\`).join('') + '</table>';
}
async function renderNewViolation() {
    const { types, vehicles } = await api('/api/violations/meta');
    document.getElementById('app').innerHTML = \`
        <div class="card">
            <h2>تسجيل مخالفة جديدة</h2>
            <label>نوع المخالفة</label>
            <select id="v-type">\${types.map(t => \`<option>\${t}</option>\`).join('')}</select>
            <label>المركبة</label>
            <select id="v-vehicle">\${vehicles.length ? vehicles.map(v => \`<option>\${v}</option>\`).join('') : '<option disabled>لا توجد مركبات مضافة</option>'}</select>
            <div class="row" style="gap:8px;margin-top:10px;">
                <button class="btn" onclick="submitViolation()">إرسال</button>
                <button class="btn gray" onclick="renderDashboard()">رجوع</button>
            </div>
        </div>\`;
}
async function submitViolation() {
    const violationType = document.getElementById('v-type').value;
    const vehicle = document.getElementById('v-vehicle').value;
    try { await api('/api/violations/submit', { method: 'POST', body: JSON.stringify({ violationType, vehicle }) }); toast('تم الإرسال، بانتظار قبول الإدارة'); renderDashboard(); }
    catch (e) { toast(e.message); }
}
function renderCard() {
    document.getElementById('app').innerHTML = \`
        <div style="margin-top:30px;">
            <div class="id-card">
                \${ME.avatar ? \`<img class="avatar" src="\${ME.avatar}" style="display:block;margin:0 auto 12px;">\` : ''}
                <div class="center" style="font-size:18px;font-weight:bold;color:#93c5fd;">\${ME.registeredName}</div>
                <div class="center" style="font-size:13px;color:#64748b;margin-bottom:14px;">${CONFIG.SITE_NAME} • بطاقة تعريف عسكرية</div>
                <table>
                    <tr><td>اليونت</td><td>\${ME.unit}</td></tr>
                    <tr><td>الرتبة</td><td>\${ME.rank}</td></tr>
                    <tr><td>النقاط</td><td>\${ME.points}</td></tr>
                    <tr><td>الحالة</td><td>\${ME.isBlocked ? 'موقوف' : 'فعّال'}</td></tr>
                </table>
            </div>
            <div class="center" style="margin-top:16px;"><button class="btn gray sm" onclick="renderDashboard()">رجوع</button></div>
        </div>\`;
}
async function renderAdmin() {
    document.getElementById('app').innerHTML = \`
        <div class="card row"><h2>لوحة الإدارة</h2><button class="btn gray sm" onclick="renderDashboard()">رجوع للوحتي</button></div>
        <div class="tabs">
            <div class="tab active" onclick="adminTab('pending', this)">المخالفات المعلّقة</div>
            <div class="tab" onclick="adminTab('personnel', this)">العسكريون</div>
            <div class="tab" onclick="adminTab('settings', this)">الإعدادات</div>
        </div>
        <div id="admin-content"></div>\`;
    adminTab('pending');
}
function adminTab(name, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    if (name === 'pending') loadPending();
    if (name === 'personnel') loadPersonnel();
    if (name === 'settings') loadSettings();
}
async function loadPending() {
    const box = document.getElementById('admin-content');
    box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    const { list } = await api('/api/admin/pending');
    if (list.length === 0) { box.innerHTML = '<div class="card center" style="color:#64748b;">لا توجد مخالفات معلّقة</div>'; return; }
    box.innerHTML = list.map(v => \`
        <div class="card">
            <div class="row">
                <div>
                    <b>\${v.reporterName}</b> <span style="color:#64748b;font-size:12px;">(\${v.reporterUnit})</span>
                    <div style="color:#93c5fd;margin-top:4px;">\${v.violationType}</div>
                    <div style="color:#64748b;font-size:13px;">المركبة: \${v.vehicle} • اللوحة: \${v.plateNumber}</div>
                </div>
                <div class="row" style="gap:8px;">
                    <button class="btn sm" onclick="approveV('\${v._id}')">قبول</button>
                    <button class="btn danger sm" onclick="rejectV('\${v._id}')">رفض</button>
                </div>
            </div>
        </div>\`).join('');
}
async function approveV(id) {
    try { await api('/api/admin/violations/' + id + '/approve', { method: 'POST' }); toast('تم القبول'); loadPending(); }
    catch (e) { toast(e.message); }
}
function rejectV(id) {
    const reason = prompt('اكتب سبب الرفض:');
    if (reason === null) return;
    if (!reason.trim()) return toast('لازم تكتب سبب');
    api('/api/admin/violations/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason }) })
        .then(() => { toast('تم الرفض'); loadPending(); }).catch(e => toast(e.message));
}
async function loadPersonnel() {
    const box = document.getElementById('admin-content');
    box.innerHTML = \`<div class="card"><input id="p-search" placeholder="بحث بالاسم / اليونت / التاق" onkeyup="if(event.key==='Enter') searchPersonnel()"><button class="btn sm" onclick="searchPersonnel()">بحث</button></div><div id="p-list"></div>\`;
    searchPersonnel();
}
async function searchPersonnel() {
    const q = document.getElementById('p-search') ? document.getElementById('p-search').value : '';
    const { list } = await api('/api/admin/personnel?q=' + encodeURIComponent(q));
    document.getElementById('p-list').innerHTML = list.map(p => \`
        <div class="card">
            <div class="row">
                <div>
                    <b>\${p.registeredName || p.discordTag}</b> <span style="color:#64748b;font-size:12px;">\${p.unit || ''}</span>
                    <div style="font-size:13px;color:#94a3b8;">النقاط: \${p.points} \${p.isBlocked ? '• 🚫 موقوف' : ''}</div>
                </div>
                <div class="row" style="gap:6px;">
                    <button class="btn sm gray" onclick="addNote('\${p.discord}')">ملاحظة</button>
                    <button class="btn sm \${p.isBlocked ? '' : 'danger'}" onclick="toggleBlock('\${p.discord}', \${!p.isBlocked})">\${p.isBlocked ? 'إلغاء الإيقاف' : 'إيقاف'}</button>
                </div>
            </div>
        </div>\`).join('') || '<div class="card center" style="color:#64748b;">لا نتائج</div>';
}
function addNote(discordId) {
    const text = prompt('اكتب الملاحظة:');
    if (!text || !text.trim()) return;
    api('/api/admin/personnel/' + discordId + '/note', { method: 'POST', body: JSON.stringify({ text }) })
        .then(() => toast('تمت الإضافة')).catch(e => toast(e.message));
}
function toggleBlock(discordId, blocked) {
    api('/api/admin/personnel/' + discordId + '/block', { method: 'POST', body: JSON.stringify({ blocked }) })
        .then(() => { toast('تم التحديث'); searchPersonnel(); }).catch(e => toast(e.message));
}
async function loadSettings() {
    const { settings } = await api('/api/admin/settings');
    document.getElementById('admin-content').innerHTML = \`
        <div class="card">
            <div class="row"><span>وضع الصيانة</span><input type="checkbox" id="s-maint" \${settings.isMaintenance ? 'checked' : ''}></div>
            <div class="row" style="margin-top:10px;"><span>إغلاق تسجيل الدخول</span><input type="checkbox" id="s-login" \${settings.disableLogin ? 'checked' : ''}></div>
            <div class="row" style="margin-top:10px;"><span>إغلاق تسجيل المخالفات</span><input type="checkbox" id="s-viol" \${settings.disableViolations ? 'checked' : ''}></div>
            <button class="btn" style="margin-top:14px;" onclick="saveSettings()">حفظ الإعدادات</button>
        </div>\`;
}
async function saveSettings() {
    const body = { isMaintenance: document.getElementById('s-maint').checked, disableLogin: document.getElementById('s-login').checked, disableViolations: document.getElementById('s-viol').checked };
    try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) }); toast('تم الحفظ'); }
    catch (e) { toast(e.message); }
}
init();
</script>
</body>
</html>`);
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`🚀 ${CONFIG.SITE_NAME} server running on port ${CONFIG.PORT}`);
});
