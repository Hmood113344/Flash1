// ══════════════════════════════════════════════════════════════════════════
// فلاش — الموقع العسكري (ملف واحد شامل: إعدادات + موقع + بوت)
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
    UserSelectMenuBuilder,
    AttachmentBuilder,
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
    SESSION_SECRET: process.env.SESSION_SECRET || "غيّر_هذا_السر_2026",
    PORT: process.env.PORT || 7700,

    // رتب العسكر المعتمدة لتسجيل الدخول بالموقع (رولات ديسكورد)
    MILITARY_ROLE_IDS: [
        "1500064443537686588",
        "1500064767082233926",
        "1533192878510178304",
    ],

    // آيديات كبار المسؤولين — نفس أسلوب ملف البنك (مصفوفة ثابتة بالكود)
    SENIOR_ADMIN_IDS: [
         "1003511814140743825",
         "1231269832201207808",
         "1458502584481484952",
    ],

    // الرتب العسكرية الرسمية بالترتيب من الأدنى للأعلى
    MILITARY_RANKS: [
        "مستجد", "جندي", "جندي اول", "عريف", "وكيل رقيب", "رقيب", "رقيب اول", "رئيس رقباء",
        "ملازم", "ملازم اول", "ملازم اول ركن", "نقيب", "نقيب ركن", "رائد", "رائد ركن",
        "مقدم", "مقدم ركن", "عقيد", "عقيد ركن", "عميد", "عميد ركن",
        "لواء", "لواء ركن", "فريق", "فريق ركن", "فريق اول", "فريق اول ركن",
    ],
    DEFAULT_POINTS_PER_RANK: 20, // النقاط الافتراضية المطلوبة للترقية للرتبة التالية (قابلة للتعديل من لوحة كبار المسؤولين)

    VIOLATION_TYPES: [
        "تجاوز السرعة المحددة",
        "القيادة العكسية",
        "التفحيط / القيادة المتهورة",
        "تظليل كتم",
        "تظليل نيكل",
        "صدم مركبات امنيه/مواطنين",
        "هروب من رجال الامن",
        "الهروب من نقطة تفتيش",
    ],

    POINTS_ON_APPROVE: 1,
    POINTS_ON_REJECT: 1, // تُخصم (تُطرح) من نقاط العسكري عند رفض مخالفته
    MAX_VEHICLES_ADD: 60,
    MAX_PHOTO_MB: 3,
};

// ══════════════════════════════════════════════════════════════════════════
// 2) قاعدة البيانات والموديلات
// ══════════════════════════════════════════════════════════════════════════
mongoose.connect(CONFIG.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.log("❌ MongoDB error:", err));

const PersonnelSchema = new mongoose.Schema({
    discord: { type: String, required: true, unique: true },
    discordTag: String,
    registeredName: { type: String, default: null },
    unit: { type: String, default: null },
    rank: { type: String, default: "مستجد" },
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
    vehiclePhoto: { type: String, default: null },
    plateNumber: String,
    photo: { type: String, default: null }, // data URL أو رابط
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
    photo: { type: String, default: null },
    addedBy: String,
    createdAt: { type: Date, default: Date.now }
});
const Vehicle = mongoose.model("Vehicle", VehicleSchema);

const LogSchema = new mongoose.Schema({
    actorId: String,
    actorTag: String,
    action: String,
    detail: String,
    createdAt: { type: Date, default: Date.now }
});
const Log = mongoose.model("Log", LogSchema);

const SettingsSchema = new mongoose.Schema({
    isMaintenance: { type: Boolean, default: false },
    disableLogin: { type: Boolean, default: false },
    disableViolations: { type: Boolean, default: false },
    adminList: { type: [String], default: [] }, // إداريون معيّنون (يقبلون/يرفضون المخالفات فقط)
    rankThresholds: { type: Map, of: Number, default: {} }, // رتبة -> نقاط مطلوبة للرتبة التالية
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

async function logEvent(actorId, actorTag, action, detail) {
    try { await Log.create({ actorId, actorTag, action, detail }); } catch (e) { /* تجاهل */ }
}

function generatePlate() {
    const letters = "أبجدهوزحطيكلمنسعفصقرشتثخذضظغ";
    const pick = () => letters[Math.floor(Math.random() * letters.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${pick()} ${pick()} ${pick()} - ${num}`;
}

function rankIndex(rank) {
    const i = CONFIG.MILITARY_RANKS.indexOf(rank);
    return i === -1 ? 0 : i;
}

function isSeniorAdmin(userId) {
    return CONFIG.SENIOR_ADMIN_IDS.includes(userId);
}

async function isAnyAdmin(userId) {
    if (isSeniorAdmin(userId)) return true;
    const settings = await getSettings();
    return settings.adminList.includes(userId);
}

async function getThreshold(rank, settings) {
    const s = settings || await getSettings();
    const t = s.rankThresholds && typeof s.rankThresholds.get === "function" ? s.rankThresholds.get(rank) : undefined;
    return (t !== undefined && t !== null) ? t : CONFIG.DEFAULT_POINTS_PER_RANK;
}

async function rankProgress(p, settings) {
    const idx = rankIndex(p.rank);
    const isMax = idx >= CONFIG.MILITARY_RANKS.length - 1;
    const nextRank = isMax ? null : CONFIG.MILITARY_RANKS[idx + 1];
    const threshold = isMax ? 0 : await getThreshold(p.rank, settings);
    const remaining = isMax ? 0 : Math.max(0, threshold - p.points);
    return { currentRank: p.rank, nextRank, threshold, remaining };
}

// ══════════════════════════════════════════════════════════════════════════
// 3) بوت الديسكورد
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
const rankFlowState = new Map(); // userId -> { targetId, step }
let botReady = false;

async function hasCommandRole(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const settings = await getSettings();
    const roles = Object.values(settings.commandRoles || {}).filter(Boolean);
    return roles.some(r => member.roles.cache.has(r));
}

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

// إرسال المخالفة تلقائياً لقناة المخالفات فور تسجيلها من الموقع
async function postViolationToChannel(v) {
    const settings = await getSettings();
    if (!botReady || !settings.violationsChannelId) return;
    try {
        const channel = await client.channels.fetch(settings.violationsChannelId);
        const embed = buildViolationEmbed(v);
        const components = [buildViolationButtons(v._id.toString())];
        const files = [];
        if (v.photo && v.photo.startsWith("data:image")) {
            const base64Data = v.photo.split(",")[1];
            const buffer = Buffer.from(base64Data, "base64");
            const ext = v.photo.includes("image/png") ? "png" : "jpg";
            const fname = `violation_${v._id}.${ext}`;
            files.push(new AttachmentBuilder(buffer, { name: fname }));
            embed.setImage(`attachment://${fname}`);
        }
        const msg = await channel.send({ embeds: [embed], components, files });
        pendingMessages.set(v._id.toString(), { channelId: msg.channelId, messageId: msg.id });
    } catch (e) { console.error("❌ فشل إرسال المخالفة للقناة:", e.message); }
}

// تحديث رسالة المخالفة بالقناة بعد قبول/رفض (سواء من البوت أو من الموقع)
async function syncViolationMessage(v) {
    const ref = pendingMessages.get(v._id.toString());
    if (!ref) return;
    try {
        const channel = await client.channels.fetch(ref.channelId);
        const msg = await channel.messages.fetch(ref.messageId);
        const color = v.status === "approved" ? 0x22c55e : v.status === "rejected" ? 0xef4444 : 0xf59e0b;
        const title = v.status === "approved" ? "✅ مخالفة مقبولة" : v.status === "rejected" ? "❌ مخالفة مرفوضة" : "🚨 مخالفة جديدة بانتظار المراجعة";
        const oldEmbed = msg.embeds[0] ? EmbedBuilder.from(msg.embeds[0]) : buildViolationEmbed(v);
        const embed = oldEmbed.setColor(color).setTitle(title);
        await msg.edit({ embeds: [embed], components: [buildViolationButtons(v._id.toString(), v.status !== "pending")] });
    } catch (e) { /* تجاهل */ }
    if (v.status !== "pending") pendingMessages.delete(v._id.toString());
}

async function approveViolation(v, actorId, actorTag) {
    v.status = "approved"; v.reviewedBy = actorId; v.reviewedByTag = actorTag; v.reviewedAt = new Date();
    await v.save();
    await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: CONFIG.POINTS_ON_APPROVE } });
    await syncViolationMessage(v);
    await logEvent(actorId, actorTag, "قبول مخالفة", `${v.violationType} — ${v.reporterName}`);
}

async function rejectViolation(v, actorId, actorTag, reason) {
    v.status = "rejected"; v.rejectReason = reason; v.reviewedBy = actorId; v.reviewedByTag = actorTag; v.reviewedAt = new Date();
    await v.save();
    await Personnel.findOneAndUpdate({ discord: v.reporterDiscord }, { $inc: { points: -CONFIG.POINTS_ON_REJECT } });
    await Personnel.updateOne({ discord: v.reporterDiscord, points: { $lt: 0 } }, { $set: { points: 0 } });
    await syncViolationMessage(v);
    await logEvent(actorId, actorTag, "رفض مخالفة", `${v.violationType} — ${v.reporterName} — السبب: ${reason}`);
}

const commands = [
    new SlashCommandBuilder()
        .setName("تسطيب-النظام")
        .setDescription("إعداد رتب القيادة وقناة المخالفات (للإدارة فقط)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(o => o.setName("قائد_الدوريات").setDescription("رول قائد الدوريات").setRequired(true))
        .addRoleOption(o => o.setName("نائب_قائد_الدوريات").setDescription("رول نائب قائد الدوريات").setRequired(true))
        .addRoleOption(o => o.setName("قائد_امن_الطرق").setDescription("رول قائد أمن الطرق").setRequired(true))
        .addRoleOption(o => o.setName("نائب_قائد_امن_الطرق").setDescription("رول نائب قائد أمن الطرق").setRequired(true))
        .addRoleOption(o => o.setName("قائد_مكافحة_المخدرات").setDescription("رول قائد مكافحة المخدرات").setRequired(true))
        .addRoleOption(o => o.setName("نائب_قائد_مكافحة_المخدرات").setDescription("رول نائب قائد مكافحة المخدرات").setRequired(true))
        .addRoleOption(o => o.setName("رتبة_الاداره").setDescription("رول الإدارة العليا").setRequired(true))
        .addChannelOption(o => o.setName("قناة_المخالفات").setDescription("القناة التي تُرسل لها المخالفات الجديدة").setRequired(true)),

    new SlashCommandBuilder()
        .setName("لوحة-القيادة")
        .setDescription("فتح لوحة أوامر القيادة العسكرية"),
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

function commandPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("🎖️ لوحة القيادة العسكرية")
        .setColor(0x1f8a4c)
        .setDescription("هلا فيك يا قائد، اختر من الأزرار تحت الأمر اللي تبيه:\n\n🔹 **تعيين يونت** — تحط يونت (ورتبة اختياري) لعسكري\n🔹 **تعديل نقاط** — تزيد أو تنقص نقاط عسكري\n🔹 **عرض ملف** — تشوف ملف عسكري كامل\n🔹 **تحديد رتبة عسكرية** — ترقية أو تنزيل عسكري");
}

function commandPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cmdpanel_unit").setLabel("تعيين يونت").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cmdpanel_points").setLabel("تعديل نقاط").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cmdpanel_profile").setLabel("عرض ملف").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cmdpanel_rank").setLabel("تحديد رتبة عسكرية").setStyle(ButtonStyle.Success),
    );
}

client.on("interactionCreate", async interaction => {
    try {
        // ── أوامر السلاش ─────────────────────────────────────────────
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
                settings.violationsChannelId = interaction.options.getChannel("قناة_المخالفات").id;
                await settings.save();
                return interaction.reply({ content: "✅ تم تسطيب النظام وحفظ رتب القيادة وقناة المخالفات بنجاح.", ephemeral: true });
            }

            if (commandName === "لوحة-القيادة") {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const allowed = await hasCommandRole(member);
                if (!allowed) {
                    return interaction.reply({ content: "🚫 هذا الأمر مخصص للقيادة العسكرية فقط.", ephemeral: true });
                }
                return interaction.reply({ embeds: [commandPanelEmbed()], components: [commandPanelRow()] });
            }
            return;
        }

        // ── أزرار ─────────────────────────────────────────────────────
        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id.startsWith("approve_") || id.startsWith("reject_")) {
                const [action, vid] = id.split("_");
                const allowed = await isAnyAdmin(interaction.user.id);
                const isDiscordAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
                if (!allowed && !isDiscordAdmin) {
                    return interaction.reply({ content: "🚫 ما تملك صلاحية.", ephemeral: true });
                }
                const v = await Violation.findById(vid);
                if (!v || v.status !== "pending") {
                    return interaction.reply({ content: "هذه المخالفة تمت مراجعتها مسبقاً.", ephemeral: true });
                }
                if (action === "approve") {
                    await approveViolation(v, interaction.user.id, interaction.user.username);
                    return interaction.deferUpdate();
                }
                if (action === "reject") {
                    const modal = new ModalBuilder().setCustomId(`rejectmodal_${vid}`).setTitle("سبب الرفض");
                    const input = new TextInputBuilder()
                        .setCustomId("reason").setLabel("اكتب سبب رفض المخالفة")
                        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }
                return;
            }

            if (id.startsWith("cmdpanel_")) {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const allowed = await hasCommandRole(member);
                if (!allowed) return interaction.reply({ content: "🚫 هذا الأمر مخصص للقيادة العسكرية فقط.", ephemeral: true });
                const action = id.split("_")[1]; // unit | points | profile | rank
                const select = new UserSelectMenuBuilder().setCustomId(`cmdsel_${action}`).setPlaceholder("اختر العسكري المستهدف");
                return interaction.reply({ content: "👤 اختر العسكري:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
            }
            return;
        }

        // ── قوائم اختيار العضو ───────────────────────────────────────
        if (interaction.isUserSelectMenu() && interaction.customId.startsWith("cmdsel_")) {
            const action = interaction.customId.split("_")[1];
            const targetId = interaction.values[0];

            if (action === "unit") {
                const modal = new ModalBuilder().setCustomId(`unitmodal_${targetId}`).setTitle("تعيين يونت");
                const unitInput = new TextInputBuilder().setCustomId("unit").setLabel("اسم اليونت").setStyle(TextInputStyle.Short).setRequired(true);
                const rankInput = new TextInputBuilder().setCustomId("rank").setLabel("الرتبة (اختياري)").setStyle(TextInputStyle.Short).setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(unitInput), new ActionRowBuilder().addComponents(rankInput));
                return interaction.showModal(modal);
            }
            if (action === "points") {
                const modal = new ModalBuilder().setCustomId(`pointsmodal_${targetId}`).setTitle("تعديل نقاط");
                const amountInput = new TextInputBuilder().setCustomId("amount").setLabel("عدد النقاط (موجب للإضافة، سالب للخصم)").setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
                return interaction.showModal(modal);
            }
            if (action === "profile") {
                const p = await Personnel.findOne({ discord: targetId });
                if (!p) return interaction.reply({ content: "لا يوجد ملف لهذا العضو بعد.", ephemeral: true });
                const embed = new EmbedBuilder()
                    .setTitle(`ملف: ${p.registeredName || targetId}`)
                    .setColor(0x1f8a4c)
                    .addFields(
                        { name: "اليونت", value: p.unit || "-", inline: true },
                        { name: "الرتبة", value: p.rank || "-", inline: true },
                        { name: "النقاط", value: String(p.points), inline: true },
                        { name: "الحالة", value: p.isBlocked ? "🚫 موقوف" : "✅ فعّال", inline: true },
                    );
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (action === "rank") {
                rankFlowState.set(interaction.user.id, { targetId, step: "await_type" });
                await interaction.reply({ content: "✍️ اكتب في هذه القناة: **ترقية** أو **تنزيل** (خلال 60 ثانية)", ephemeral: true });
                const filter = m => m.author.id === interaction.user.id;
                try {
                    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
                    const msg = collected.first();
                    const text = msg.content.trim();
                    msg.delete().catch(() => {});
                    if (text !== "ترقية" && text !== "تنزيل") {
                        rankFlowState.delete(interaction.user.id);
                        return interaction.followUp({ content: "❌ انتهت العملية بالفشل.", ephemeral: true });
                    }
                    const p = await Personnel.findOne({ discord: targetId });
                    const currentRank = p ? p.rank : "مستجد";
                    const currentIdx = rankIndex(currentRank);
                    await interaction.followUp({ content: `العضو الآن رتبته **${currentRank}**.\n✍️ وش تبي تعطيه؟ اكتب اسم الرتبة الجديدة بالضبط (خلال 60 ثانية):`, ephemeral: true });
                    const collected2 = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
                    const msg2 = collected2.first();
                    const newRank = msg2.content.trim();
                    msg2.delete().catch(() => {});
                    if (!CONFIG.MILITARY_RANKS.includes(newRank)) {
                        rankFlowState.delete(interaction.user.id);
                        return interaction.followUp({ content: "❌ انتهت العملية بالفشل، هذي الرتبة مو موجودة.", ephemeral: true });
                    }
                    const newIdx = rankIndex(newRank);
                    if (text === "ترقية" && newIdx <= currentIdx) {
                        rankFlowState.delete(interaction.user.id);
                        return interaction.followUp({ content: "❌ انتهت العملية بالفشل بسبب ترقيته برتبة أقل من أو تساوي رتبته الحالية.", ephemeral: true });
                    }
                    if (text === "تنزيل" && newIdx >= currentIdx) {
                        rankFlowState.delete(interaction.user.id);
                        return interaction.followUp({ content: "❌ انتهت العملية بالفشل بسبب تنزيله لرتبة أعلى من أو تساوي رتبته الحالية.", ephemeral: true });
                    }
                    await Personnel.findOneAndUpdate(
                        { discord: targetId },
                        { $set: { rank: newRank }, $setOnInsert: { discordTag: targetId } },
                        { upsert: true }
                    );
                    await logEvent(interaction.user.id, interaction.user.username, text === "ترقية" ? "ترقية عسكري" : "تنزيل عسكري", `<@${targetId}>: ${currentRank} ← ${newRank}`);
                    rankFlowState.delete(interaction.user.id);
                    return interaction.followUp({ content: `✅ تم ${text === "ترقية" ? "ترقية" : "تنزيل"} <@${targetId}> إلى رتبة **${newRank}**.`, ephemeral: true });
                } catch (e) {
                    rankFlowState.delete(interaction.user.id);
                    return interaction.followUp({ content: "⏱️ انتهى الوقت، تم إلغاء العملية.", ephemeral: true }).catch(() => {});
                }
            }
            return;
        }

        // ── نماذج (Modals) ───────────────────────────────────────────
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith("rejectmodal_")) {
                const vid = interaction.customId.split("_")[1];
                const reason = interaction.fields.getTextInputValue("reason");
                const v = await Violation.findById(vid);
                if (!v || v.status !== "pending") {
                    return interaction.reply({ content: "هذه المخالفة تمت مراجعتها مسبقاً.", ephemeral: true });
                }
                await rejectViolation(v, interaction.user.id, interaction.user.username, reason);
                return interaction.reply({ content: "✅ تم رفض المخالفة وحفظ السبب.", ephemeral: true });
            }
            if (interaction.customId.startsWith("unitmodal_")) {
                const targetId = interaction.customId.split("_")[1];
                const unit = interaction.fields.getTextInputValue("unit");
                const rank = interaction.fields.getTextInputValue("rank");
                const update = { unit };
                if (rank && CONFIG.MILITARY_RANKS.includes(rank)) update.rank = rank;
                const p = await Personnel.findOneAndUpdate(
                    { discord: targetId },
                    { $set: update, $setOnInsert: { discordTag: targetId } },
                    { new: true, upsert: true }
                );
                await logEvent(interaction.user.id, interaction.user.username, "تعيين يونت", `<@${targetId}> → ${p.unit}`);
                return interaction.reply({ content: `✅ تم تعيين <@${targetId}> إلى يونت **${p.unit}**${update.rank ? ` برتبة **${p.rank}**` : ""}.`, ephemeral: true });
            }
            if (interaction.customId.startsWith("pointsmodal_")) {
                const targetId = interaction.customId.split("_")[1];
                const amount = parseInt(interaction.fields.getTextInputValue("amount"));
                if (isNaN(amount)) return interaction.reply({ content: "❌ الرقم غير صحيح.", ephemeral: true });
                const p = await Personnel.findOneAndUpdate(
                    { discord: targetId },
                    { $inc: { points: amount }, $setOnInsert: { discordTag: targetId } },
                    { new: true, upsert: true }
                );
                await logEvent(interaction.user.id, interaction.user.username, "تعديل نقاط", `<@${targetId}>: ${amount >= 0 ? "+" : ""}${amount} → المجموع ${p.points}`);
                return interaction.reply({ content: `✅ تم تعديل نقاط <@${targetId}>. النقاط الحالية: **${p.points}**`, ephemeral: true });
            }
        }
    } catch (e) {
        console.error("❌ خطأ بالتفاعل:", e);
    }
});

const activeVehicleSessions = new Set();
client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith("-")) return;
    const [cmd] = message.content.slice(1).trim().split(/\s+/);
    if (cmd !== "مركبات") return;

    const senior = isSeniorAdmin(message.author.id);
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
            const p = await message.channel.send(`🚗 اكتب اسم المركبة رقم ${i} من ${count} (يمديك ترفق صورة مع الرسالة):`);
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
            const nameMsg = collected.first();
            const name = nameMsg.content.trim();
            const photo = nameMsg.attachments.first()?.url || null;
            nameMsg.delete().catch(() => {});
            p.delete().catch(() => {});
            if (!name) { i--; continue; }
            try {
                await Vehicle.create({ name, photo, addedBy: message.author.id });
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
    console.log("⚠️ BOT_TOKEN غير موجود — البوت لن يعمل، تحقق من متغيرات البيئة");
}

// ══════════════════════════════════════════════════════════════════════════
// 4) موقع الويب (Express)
// ══════════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json({ limit: "8mb" }));
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

async function ensureSeniorAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    if (!isSeniorAdmin(req.user.id)) return res.status(403).json({ error: "هذا القسم لكبار المسؤولين فقط" });
    next();
}

async function ensureAnyAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "غير مسجّل دخول" });
    const settings = await getSettings();
    if (!isSeniorAdmin(req.user.id) && !settings.adminList.includes(req.user.id)) {
        return res.status(403).json({ error: "ليست لديك صلاحية" });
    }
    req.settings = settings;
    next();
}

app.get("/api/me", ensureAuth, async (req, res) => {
    const settings = await getSettings();
    const senior = isSeniorAdmin(req.user.id);

    // كبار المسؤولين يدخلون دائماً حتى لو كان التسجيل مقفل أو الموقع بالصيانة
    if (!senior) {
        if (settings.disableLogin) {
            return res.json({ blocked: true, reason: "🔒 تسجيل الدخول مغلق حالياً من قبل الإدارة العليا." });
        }
        if (settings.isMaintenance) {
            return res.json({ blocked: true, maintenance: true, reason: "🚨 الموقع مغلق حالياً للصيانة العامة بطلب من الإدارة العليا." });
        }
        const check = await isMilitary(req.user.id);
        if (!check.ok) {
            return res.json({ blocked: true, reason: "هذا الموقع مخصص لمنسوبي الجهات العسكرية فقط" });
        }
    }

    let p = await Personnel.findOne({ discord: req.user.id });
    if (!p) p = await Personnel.create({ discord: req.user.id, discordTag: req.user.username });

    if (!senior && p.isBlocked) {
        return res.json({ blocked: true, reason: "🚫 تم إيقاف حسابك من الموقع من قبل الإدارة." });
    }

    const isAdmin = senior || settings.adminList.includes(req.user.id);
    const progress = await rankProgress(p, settings);

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
        isSeniorAdmin: senior,
        maintenance: settings.isMaintenance,
        violationsDisabled: settings.disableViolations,
        nextRank: progress.nextRank,
        pointsThreshold: progress.threshold,
        pointsRemaining: progress.remaining,
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
    res.json({ types: CONFIG.VIOLATION_TYPES, vehicles: vehicles.map(v => ({ name: v.name, photo: v.photo })) });
});

const VIOLATION_COOLDOWN_MS = 30 * 1000;
const violationLocks = new Set(); // يمنع إرسال مخالفتين بنفس اللحظة من نفس الحساب

app.post("/api/violations/submit", ensureAuth, async (req, res) => {
    if (violationLocks.has(req.user.id)) {
        return res.status(429).json({ error: "في مخالفة قيد الإرسال حالياً على حسابك، انتظر لحظة." });
    }
    violationLocks.add(req.user.id);
    try {
        const settings = await getSettings();
        if (settings.disableViolations) return res.status(403).json({ error: "تسجيل المخالفات مغلق حالياً" });
        const p = await Personnel.findOne({ discord: req.user.id });
        if (!p || !p.registeredName || !p.unit) return res.status(400).json({ error: "أكمل بياناتك (الاسم واليونت) أولاً" });
        if (p.isBlocked) return res.status(403).json({ error: "أنت موقوف عن تسجيل مخالفات جديدة" });

        const last = await Violation.findOne({ reporterDiscord: req.user.id }).sort({ createdAt: -1 });
        if (last) {
            const elapsed = Date.now() - last.createdAt.getTime();
            if (elapsed < VIOLATION_COOLDOWN_MS) {
                const wait = Math.ceil((VIOLATION_COOLDOWN_MS - elapsed) / 1000);
                return res.status(429).json({ error: `لازم تنتظر ${wait} ثانية قبل تسجيل مخالفة جديدة`, cooldown: wait });
            }
        }

        const { violationType, vehicle, photo } = req.body;
        if (!violationType || !vehicle) return res.status(400).json({ error: "أكمل نوع المخالفة والمركبة" });
        if (photo && photo.length > CONFIG.MAX_PHOTO_MB * 1024 * 1024 * 1.4) {
            return res.status(400).json({ error: `الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB` });
        }
        const vehicleDoc = await Vehicle.findOne({ name: vehicle });

        const v = await Violation.create({
            reporterDiscord: req.user.id, reporterTag: req.user.username,
            reporterName: p.registeredName, reporterUnit: p.unit,
            violationType, vehicle, vehiclePhoto: vehicleDoc?.photo || null,
            photo: photo || null,
            plateNumber: generatePlate(), status: "pending",
        });
        postViolationToChannel(v).catch(() => {});
        res.json({ ok: true, violation: v });
    } finally {
        violationLocks.delete(req.user.id);
    }
});

app.get("/api/violations/mine", ensureAuth, async (req, res) => {
    const list = await Violation.find({ reporterDiscord: req.user.id }).sort({ createdAt: -1 });
    res.json({ list });
});

// ── مسارات الإداري المعيَّن (قبول/رفض فقط) ──────────────────────────────
app.get("/api/admin/pending", ensureAnyAdmin, async (req, res) => {
    const list = await Violation.find({ status: "pending" }).sort({ createdAt: 1 });
    res.json({ list });
});

app.post("/api/admin/violations/:id/approve", ensureAnyAdmin, async (req, res) => {
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    await approveViolation(v, req.user.id, req.user.username);
    res.json({ ok: true });
});

app.post("/api/admin/violations/:id/reject", ensureAnyAdmin, async (req, res) => {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "لازم تكتب سبب الرفض" });
    const v = await Violation.findById(req.params.id);
    if (!v || v.status !== "pending") return res.status(404).json({ error: "غير موجودة" });
    await rejectViolation(v, req.user.id, req.user.username, reason.trim());
    res.json({ ok: true });
});

// ── مسارات كبار المسؤولين فقط ────────────────────────────────────────────
app.get("/api/senior/personnel", ensureSeniorAdmin, async (req, res) => {
    const q = (req.query.q || "").trim();
    const filter = q ? { $or: [{ registeredName: new RegExp(q, "i") }, { unit: new RegExp(q, "i") }, { discordTag: new RegExp(q, "i") }] } : {};
    const list = await Personnel.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ list });
});

app.post("/api/senior/personnel/:discord/note", ensureSeniorAdmin, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "اكتب الملاحظة" });
    const p = await Personnel.findOneAndUpdate(
        { discord: req.params.discord },
        { $push: { notes: { text: text.trim(), addedBy: req.user.id, addedByTag: req.user.username } } },
        { new: true }
    );
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent(req.user.id, req.user.username, "إضافة ملاحظة", `على ${p.registeredName || p.discord}: ${text.trim()}`);
    res.json({ ok: true, notes: p.notes });
});

app.post("/api/senior/personnel/:discord/block", ensureSeniorAdmin, async (req, res) => {
    const { blocked } = req.body;
    const p = await Personnel.findOneAndUpdate({ discord: req.params.discord }, { isBlocked: !!blocked }, { new: true });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent(req.user.id, req.user.username, blocked ? "إيقاف عسكري" : "إلغاء إيقاف", p.registeredName || p.discord);
    res.json({ ok: true, isBlocked: p.isBlocked });
});

// تعديل شامل لملف عسكري: الاسم، اليونت، الرتبة، النقاط — من لوحة كبار المسؤولين مباشرة
app.post("/api/senior/personnel/:discord/update", ensureSeniorAdmin, async (req, res) => {
    const { name, unit, rank, points } = req.body;
    const update = {};
    if (typeof name === "string" && name.trim()) update.registeredName = name.trim();
    if (typeof unit === "string" && unit.trim()) update.unit = unit.trim();
    if (typeof rank === "string" && rank.trim()) {
        if (!CONFIG.MILITARY_RANKS.includes(rank.trim())) return res.status(400).json({ error: "رتبة غير موجودة" });
        update.rank = rank.trim();
    }
    if (points !== undefined && points !== "" && !isNaN(parseInt(points))) update.points = Math.max(0, parseInt(points));

    const p = await Personnel.findOneAndUpdate({ discord: req.params.discord }, update, { new: true });
    if (!p) return res.status(404).json({ error: "غير موجود" });
    await logEvent(req.user.id, req.user.username, "تعديل ملف عسكري", `${p.discord}: ${JSON.stringify(update)}`);
    res.json({ ok: true, personnel: p });
});

app.get("/api/senior/settings", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    res.json({ settings });
});

app.post("/api/senior/settings", ensureSeniorAdmin, async (req, res) => {
    const { isMaintenance, disableLogin, disableViolations } = req.body;
    const s = await getSettings();
    if (typeof isMaintenance === "boolean") s.isMaintenance = isMaintenance;
    if (typeof disableLogin === "boolean") s.disableLogin = disableLogin;
    if (typeof disableViolations === "boolean") s.disableViolations = disableViolations;
    await s.save();
    await logEvent(req.user.id, req.user.username, "تعديل إعدادات الموقع", JSON.stringify(req.body));
    res.json({ ok: true });
});

app.get("/api/senior/admins", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    res.json({ list: settings.adminList });
});

app.post("/api/senior/hire-admin", ensureSeniorAdmin, async (req, res) => {
    const { discordId, name } = req.body;
    if (!discordId || !discordId.trim()) return res.status(400).json({ error: "حط آيدي الإداري" });
    const settings = await getSettings();
    if (!settings.adminList.includes(discordId.trim())) settings.adminList.push(discordId.trim());
    await settings.save();
    await logEvent(req.user.id, req.user.username, "توظيف إداري", `${name || ""} (${discordId.trim()})`);
    res.json({ ok: true });
});

app.post("/api/senior/fire-admin", ensureSeniorAdmin, async (req, res) => {
    const { discordId } = req.body;
    const settings = await getSettings();
    settings.adminList = settings.adminList.filter(id => id !== discordId);
    await settings.save();
    await logEvent(req.user.id, req.user.username, "فصل إداري", discordId);
    res.json({ ok: true });
});

app.get("/api/senior/vehicles", ensureSeniorAdmin, async (req, res) => {
    const list = await Vehicle.find().sort({ createdAt: -1 });
    res.json({ list });
});

app.post("/api/senior/vehicles", ensureSeniorAdmin, async (req, res) => {
    const { name, photo } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "حط اسم المركبة" });
    if (photo && photo.length > CONFIG.MAX_PHOTO_MB * 1024 * 1024 * 1.4) {
        return res.status(400).json({ error: `الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB` });
    }
    try {
        const v = await Vehicle.create({ name: name.trim(), photo: photo || null, addedBy: req.user.id });
        await logEvent(req.user.id, req.user.username, "إضافة مركبة", v.name);
        res.json({ ok: true, vehicle: v });
    } catch (e) { res.status(400).json({ error: "المركبة موجودة مسبقاً" }); }
});

app.delete("/api/senior/vehicles/:id", ensureSeniorAdmin, async (req, res) => {
    await Vehicle.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
});

app.get("/api/senior/thresholds", ensureSeniorAdmin, async (req, res) => {
    const settings = await getSettings();
    const obj = {};
    for (const r of CONFIG.MILITARY_RANKS) obj[r] = await getThreshold(r, settings);
    res.json({ ranks: CONFIG.MILITARY_RANKS, thresholds: obj });
});

app.post("/api/senior/thresholds", ensureSeniorAdmin, async (req, res) => {
    const { thresholds } = req.body;
    const settings = await getSettings();
    if (!settings.rankThresholds) settings.rankThresholds = new Map();
    Object.entries(thresholds || {}).forEach(([rank, val]) => {
        if (CONFIG.MILITARY_RANKS.includes(rank)) settings.rankThresholds.set(rank, Math.max(0, parseInt(val) || 0));
    });
    await settings.save();
    await logEvent(req.user.id, req.user.username, "تعديل حدود النقاط", "تحديث نقاط الترقية");
    res.json({ ok: true });
});

app.get("/api/senior/log", ensureSeniorAdmin, async (req, res) => {
    const list = await Log.find().sort({ createdAt: -1 }).limit(200);
    res.json({ list });
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
    :root {
        --bg1: #0a1628; --bg2: #0d1f3c; --panel: rgba(255,255,255,0.04); --border: rgba(59,130,246,0.25);
        --gold: #3b82f6; --gold-soft: #60a5fa; --green: #1d4ed8; --green2: #3b82f6;
        --red: #ef4444; --amber: #eab308; --text: #e2e8f0; --muted: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Tajawal', 'Tahoma', 'Segoe UI', sans-serif; }
    body { background: linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a2744 70%, #0d3060 100%); color: var(--text); min-height: 100vh; }
    #warn-banner { position: sticky; top: 0; z-index: 1000; width: 100%; background: linear-gradient(90deg,#7f1d1d,#991b1b); color: #fecaca; text-align: center; padding: 10px 14px; font-weight: bold; font-size: 13px; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
    nav { background: rgba(5,15,30,0.95); backdrop-filter: blur(15px); border-bottom: 1px solid rgba(59,130,246,0.3); padding: 0 1.2rem; display: flex; align-items: center; justify-content: space-between; height: 62px; position: sticky; top: 37px; z-index: 900; }
    .logo { font-size: 1.3rem; font-weight: 900; background: linear-gradient(90deg, #3b82f6, #60a5fa, #93c5fd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 2px; }
    .nav-links { display: flex; gap: 0.3rem; list-style: none; flex-wrap: wrap; }
    .nav-links button { background: transparent; border: 1px solid transparent; color: #94a3b8; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 0.85rem; transition: all 0.2s; }
    .nav-links button:hover { background: rgba(59,130,246,0.2); border-color: #3b82f6; color: #60a5fa; }
    .hamburger-btn { display: none; background: rgba(59,130,246,0.15); border: 1px solid #3b82f6; color: #60a5fa; padding: 0.4rem 0.7rem; border-radius: 8px; cursor: pointer; font-size: 1.2rem; }
    .mobile-menu { display: none; position: fixed; top: 99px; left: 0; width: 230px; background: rgba(5,15,30,0.98); border: 1px solid rgba(59,130,246,0.35); border-radius: 0 0 14px 0; z-index: 950; padding: 8px 0; box-shadow: 4px 8px 30px rgba(0,0,0,0.7); }
    .mobile-menu.open { display: block; }
    .mobile-menu button { display: block; width: 100%; background: transparent; border: none; border-bottom: 1px solid rgba(59,130,246,0.08); color: #94a3b8; padding: 12px 20px; text-align: right; font-family: inherit; font-size: 0.9rem; cursor: pointer; }
    .mobile-menu button:hover { background: rgba(59,130,246,0.18); color: #60a5fa; }
    @media (max-width: 760px) { .nav-links { display: none !important; } .hamburger-btn { display: inline-block; } }
    .wrap { max-width: 940px; margin: 0 auto; padding: 20px 16px 60px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    h1, h2, h3 { color: var(--gold-soft); margin-bottom: 12px; }
    .btn { display: inline-block; background: linear-gradient(135deg, var(--green), var(--green2)); color: #fff; border: none; border-radius: 8px; padding: 0.6rem 1.3rem; font-size: 0.9rem; font-weight: 700; cursor: pointer; transition: 0.2s; }
    .btn:hover { opacity: 0.85; transform: translateY(-1px); }
    .btn.danger { background: #ef4444; }
    .btn.gray { background: rgba(255,255,255,0.08); border: 1px solid rgba(59,130,246,0.25); color: #94a3b8; }
    .btn.gold { background: linear-gradient(135deg, #1d4ed8, #60a5fa); color: #fff; }
    .btn.sm { padding: 0.4rem 0.9rem; font-size: 0.8rem; }
    input, select, textarea { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); color: #fff; margin-bottom: 10px; font-size: 14px; }
    label { display: block; margin-bottom: 6px; color: var(--gold-soft); font-size: 13px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .badge.pending { background: rgba(234,179,8,0.15); color: #fbbf24; border: 1px solid #eab308; }
    .badge.approved { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid #22c55e; }
    .badge.rejected { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid #ef4444; }
    .stat { text-align: center; padding: 14px; background: rgba(255,255,255,0.03); border-radius: 10px; border: 1px solid var(--border); }
    .stat .num { font-size: 24px; font-weight: 900; color: var(--gold-soft); }
    .stat .lbl { font-size: 12px; color: var(--muted); }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .center { text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border-bottom: 1px solid var(--border); text-align: right; vertical-align: middle; }
    .avatar { width: 70px; height: 70px; border-radius: 50%; border: 3px solid var(--gold); }
    .thumb { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); cursor: pointer; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .tab { background: rgba(255,255,255,0.04); border: 1px solid rgba(59,130,246,0.3); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #94a3b8; }
    .tab.active { background: var(--green2); color: #fff; border-color: var(--green2); }
    .id-card { background: linear-gradient(135deg, #1e3a5f, #0f2848); border: 2px solid var(--gold); border-radius: 20px; padding: 22px; max-width: 400px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .rank-line { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 15px; color: var(--gold-soft); margin: 10px 0; font-weight: bold; }
    .hidden { display: none !important; }
    #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #0d1f3c; padding: 10px 20px; border-radius: 10px; border: 1px solid var(--gold); z-index: 999; display: none; }
    .fab { position: fixed; bottom: 25px; right: 25px; z-index: 998; background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: #fff; border: 2px solid rgba(255,255,255,0.2); padding: 14px 24px; border-radius: 50px; font-weight: bold; font-family: inherit; font-size: 14px; cursor: pointer; box-shadow: 0 4px 20px rgba(0,0,0,0.4); transition: 0.3s; }
    .fab:hover { transform: scale(1.05); }
    .vgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .vcard { border: 2px solid var(--border); border-radius: 10px; padding: 6px; text-align: center; cursor: pointer; font-size: 11px; background: rgba(255,255,255,0.03); }
    .vcard.sel { border-color: var(--gold); background: rgba(59,130,246,0.12); }
    .vcard img { width: 100%; height: 54px; object-fit: cover; border-radius: 6px; margin-bottom: 4px; }
    .login-screen { text-align: center; padding: 4rem 2rem; }
    .login-screen h1 { font-size: 3rem; color: #3b82f6; text-shadow: 0 0 20px rgba(59,130,246,0.5); margin-bottom: 10px; }
    footer { text-align: center; padding: 1.5rem; margin-top: 2rem; border-top: 1px solid var(--border); background: rgba(255,255,255,0.02); color: var(--muted); font-size: 0.9rem; }
</style>
</head>
<body>
<div id="warn-banner">⚠️ تنبيه: هذا الموقع مخصص للمحاكاة واللعب فقط، ولا يمت للواقع بصلة.</div>
<nav>
    <div class="logo">🚨 ${CONFIG.SITE_NAME}</div>
    <ul class="nav-links" id="nav-links"></ul>
    <button class="hamburger-btn" onclick="toggleMobileMenu()">☰</button>
</nav>
<div class="mobile-menu" id="mobile-menu"></div>
<div class="wrap" id="app"><div class="card center">جارِ التحميل...</div></div>
<div id="toast"></div>
<footer><p>جميع الحقوق محفوظة © 2026 | <span style="color:#d4af37;font-weight:bold;">${CONFIG.SITE_NAME}</span></p></footer>

<script>
const MILITARY_RANKS = ${JSON.stringify(CONFIG.MILITARY_RANKS)};
let ME = null;
let lastKnownRank = null;
let META = { types: [], vehicles: [] };
let selectedVehicle = null;
let photoBase64 = null;

async function api(url, opts) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'خطأ');
    return data;
}
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2800);
}
async function init() {
    try { ME = await api('/api/me'); } catch (e) { renderLogin(); return; }
    if (ME.blocked) { renderBlocked(ME.reason); return; }
    lastKnownRank = ME.rank;
    buildNav();
    if (!ME.registeredName || !ME.unit) { renderSetup(); return; }
    renderDashboard();
    startPolling();
}
function buildNav() {
    const links = document.getElementById('nav-links');
    const mobile = document.getElementById('mobile-menu');
    if (!ME || ME.blocked) { links.innerHTML = ''; mobile.innerHTML = ''; return; }
    const items = [
        { label: '🏠 الرئيسية', fn: 'renderDashboard()' },
        { label: '📝 تسجيل مخالفة', fn: 'renderNewViolation()' },
        { label: '📋 مخالفاتي', fn: 'renderMinePage()' },
        { label: '🪪 بطاقتي', fn: 'renderCard()' },
    ];
    if (ME.isAdmin) items.push({ label: '🛠️ لوحة الإدارة', fn: 'renderAdmin()' });
    items.push({ label: '🚪 خروج', fn: "location.href='/auth/logout'" });
    links.innerHTML = items.map(i => \`<button onclick="\${i.fn}">\${i.label}</button>\`).join('');
    mobile.innerHTML = items.map(i => \`<button onclick="\${i.fn}; closeMobileMenu();">\${i.label}</button>\`).join('');
}
function toggleMobileMenu() { document.getElementById('mobile-menu').classList.toggle('open'); }
function closeMobileMenu() { document.getElementById('mobile-menu').classList.remove('open'); }
function renderMinePage() {
    document.getElementById('app').innerHTML = \`<div class="card"><h2>📋 مخالفاتي</h2><div id="mine-list">جارِ التحميل...</div></div>\`;
    loadMine();
}
function startPolling() {
    setInterval(async () => {
        if (!ME || ME.blocked) return;
        try {
            const fresh = await api('/api/me');
            if (lastKnownRank && fresh.rank !== lastKnownRank) {
                toast('🎉 مبروك! تمت ترقيتك إلى ' + fresh.rank);
            }
            lastKnownRank = fresh.rank;
            ME = fresh;
            const rp = document.getElementById('home-points');
            if (rp) {
                document.getElementById('home-points').textContent = ME.points;
                document.getElementById('home-rank').textContent = ME.rank;
                const nx = document.getElementById('home-next');
                if (nx) nx.textContent = ME.nextRank ? (ME.rank + ' ——> ' + ME.nextRank) : 'أعلى رتبة';
                const rem = document.getElementById('home-remaining');
                if (rem) rem.textContent = ME.nextRank ? ('متبقي ' + ME.pointsRemaining + ' نقطة للترقية') : 'وصلت لأعلى رتبة';
            }
            if (document.getElementById('mine-list')) loadMine(true);
            if (document.getElementById('pending-box')) loadPending();
        } catch (e) {}
    }, 9000);
}
function renderLogin() {
    document.getElementById('nav-links').innerHTML = '';
    document.getElementById('mobile-menu').innerHTML = '';
    document.getElementById('app').innerHTML = \`
        <div class="login-screen">
            <h1>${CONFIG.SITE_NAME}</h1>
            <p style="color:var(--muted);margin-bottom:28px;">نظام إدارة عسكري لمنسوبي الجهات العسكرية</p>
            <a href="/auth/discord" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#5865F2;color:#fff;font-weight:bold;font-size:16px;padding:16px 34px;border-radius:10px;text-decoration:none;box-shadow:0 6px 18px rgba(88,101,242,0.4);">
                <span>🔒</span><span>تسجيل الدخول عبر ديسكورد</span>
            </a>
        </div>\`;
}
function renderBlocked(reason) {
    document.getElementById('nav-links').innerHTML = '';
    document.getElementById('mobile-menu').innerHTML = '';
    document.getElementById('app').innerHTML = \`
        <div class="card center" style="margin-top:60px;">
            <h2 style="color:#fca5a5;">🚫 غير مصرح</h2>
            <p style="color:var(--muted);margin-top:10px;">\${reason}</p>
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
                <div><h2 style="margin-bottom:2px;">\${ME.registeredName}</h2><div style="color:var(--muted);font-size:13px;">\${ME.unit} • \${ME.rank}</div></div>
            </div>
            <div class="row" style="gap:8px;">
                \${ME.isAdmin ? '<button class="btn gray sm" onclick="renderAdmin()">لوحة الإدارة</button>' : ''}
                <a class="btn gray sm" href="/auth/logout">خروج</a>
            </div>
        </div>
        \${ME.maintenance ? '<div class="card" style="border-color:var(--amber);color:#fbbf24;">⚠️ الموقع في وضع الصيانة حالياً</div>' : ''}
        <div class="id-card">
            \${ME.avatar ? \`<div class="center"><img class="avatar" src="\${ME.avatar}" style="width:84px;height:84px;margin-bottom:10px;"></div>\` : ''}
            <div class="center" style="font-size:18px;font-weight:bold;color:var(--gold-soft);">\${ME.registeredName}</div>
            <div class="center" style="font-size:12px;color:var(--muted);margin-bottom:10px;">${CONFIG.SITE_NAME} • بطاقة تعريف عسكرية</div>
            <div class="rank-line" id="home-next">\${ME.rank} \${ME.nextRank ? ('——> ' + ME.nextRank) : ''}</div>
            <div class="center" style="font-size:13px;color:var(--muted);" id="home-remaining">\${ME.nextRank ? ('متبقي ' + ME.pointsRemaining + ' نقطة للترقية') : 'وصلت لأعلى رتبة'}</div>
        </div>
        <div class="grid3" style="margin-top:16px;">
            <div class="stat"><div class="num" id="home-points">\${ME.points}</div><div class="lbl">النقاط</div></div>
            <div class="stat"><div class="num" id="mine-count">-</div><div class="lbl">مخالفاتي</div></div>
            <div class="stat"><div class="num" id="home-rank" style="font-size:15px;">\${ME.isBlocked ? '🚫 موقوف' : '✅ فعّال'}</div><div class="lbl">الحالة</div></div>
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
        \${ME.isSeniorAdmin ? '<button class="fab" onclick="renderAdmin()">🛡️ لوحة كبار المسؤولين</button>' : ''}
    \`;
    loadMine();
    renderNotes();
}
function renderNotes() {
    const box = document.getElementById('notes-box');
    if (!box) return;
    if (!ME.notes || ME.notes.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="font-size:13px;color:var(--gold-soft);margin-bottom:6px;">ملاحظات عليك:</div>' +
        ME.notes.map(n => \`<div style="background:rgba(5,15,10,0.6);padding:8px;border-radius:8px;margin-bottom:6px;font-size:13px;">\${n.text}</div>\`).join('');
}
async function loadMine(silent) {
    const { list } = await api('/api/violations/mine');
    const cEl = document.getElementById('mine-count');
    if (cEl) cEl.textContent = list.length;
    const box = document.getElementById('mine-list');
    if (!box) return;
    if (list.length === 0) { box.innerHTML = '<p style="color:var(--muted);">لا توجد مخالفات مسجلة بعد</p>'; return; }
    box.innerHTML = \`<table><tr><th></th><th>النوع</th><th>المركبة</th><th>اللوحة</th><th>الحالة</th></tr>\` +
        list.map(v => \`<tr>
            <td>\${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="window.open('\${v.photo}','_blank')">\` : '—'}</td>
            <td>\${v.violationType}</td><td>\${v.vehicle}</td><td>\${v.plateNumber}</td>
            <td><span class="badge \${v.status}">\${v.status === 'pending' ? 'قيد المراجعة' : v.status === 'approved' ? 'مقبولة' : 'مرفوضة'}</span>\${v.status === 'rejected' && v.rejectReason ? \`<div style="font-size:11px;color:var(--muted);margin-top:3px;">\${v.rejectReason}</div>\` : ''}</td>
        </tr>\`).join('') + '</table>';
}
async function renderNewViolation() {
    const meta = await api('/api/violations/meta');
    META = meta; selectedVehicle = null; photoBase64 = null;
    document.getElementById('app').innerHTML = \`
        <div class="card">
            <h2>تسجيل مخالفة جديدة</h2>
            <label>نوع المخالفة</label>
            <select id="v-type">\${meta.types.map(t => \`<option>\${t}</option>\`).join('')}</select>
            <label>المركبة</label>
            \${meta.vehicles.length ? \`<div class="vgrid" id="v-grid">\${meta.vehicles.map((v,i) => \`
                <div class="vcard" id="vcard-\${i}" onclick="pickVehicle(\${i})">
                    \${v.photo ? \`<img src="\${v.photo}">\` : ''}
                    <div>\${v.name}</div>
                </div>\`).join('')}</div>\` : '<p style="color:var(--muted);margin-bottom:10px;">لا توجد مركبات مضافة</p>'}
            <label>صورة المخالفة (اختياري)</label>
            <input type="file" id="v-photo" accept="image/*" onchange="previewPhoto()">
            <img id="v-photo-preview" style="display:none;max-width:220px;border-radius:8px;margin-bottom:10px;">
            <div class="row" style="gap:8px;margin-top:10px;">
                <button class="btn" onclick="submitViolation()">إرسال</button>
                <button class="btn gray" onclick="renderDashboard()">رجوع</button>
            </div>
        </div>\`;
    if (meta.vehicles.length) pickVehicle(0);
}
function pickVehicle(i) {
    selectedVehicle = META.vehicles[i].name;
    document.querySelectorAll('.vcard').forEach(el => el.classList.remove('sel'));
    document.getElementById('vcard-' + i).classList.add('sel');
}
function previewPhoto() {
    const f = document.getElementById('v-photo').files[0];
    if (!f) return;
    if (f.size > ${CONFIG.MAX_PHOTO_MB} * 1024 * 1024) { toast('الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        photoBase64 = e.target.result;
        const img = document.getElementById('v-photo-preview');
        img.src = photoBase64; img.style.display = 'block';
    };
    reader.readAsDataURL(f);
}
async function submitViolation() {
    const violationType = document.getElementById('v-type').value;
    if (!selectedVehicle) return toast('اختر المركبة');
    try {
        await api('/api/violations/submit', { method: 'POST', body: JSON.stringify({ violationType, vehicle: selectedVehicle, photo: photoBase64 }) });
        toast('تم الإرسال، بانتظار قبول الإدارة'); renderDashboard();
    } catch (e) { toast(e.message); }
}
function renderCard() {
    document.getElementById('app').innerHTML = \`
        <div style="margin-top:30px;">
            <div class="id-card">
                \${ME.avatar ? \`<img class="avatar" src="\${ME.avatar}" style="display:block;margin:0 auto 12px;">\` : ''}
                <div class="center" style="font-size:18px;font-weight:bold;color:var(--gold-soft);">\${ME.registeredName}</div>
                <div class="center" style="font-size:13px;color:var(--muted);margin-bottom:14px;">${CONFIG.SITE_NAME} • بطاقة تعريف عسكرية</div>
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
function renderAdmin() {
    const tabsHtml = ME.isSeniorAdmin ? \`
        <div class="tabs">
            <div class="tab active" onclick="adminTab('pending', this)">المخالفات المعلّقة</div>
            <div class="tab" onclick="adminTab('personnel', this)">العسكريون</div>
            <div class="tab" onclick="adminTab('vehicles', this)">المركبات</div>
            <div class="tab" onclick="adminTab('hire', this)">توظيف الإدارة</div>
            <div class="tab" onclick="adminTab('thresholds', this)">ترقيات النقاط</div>
            <div class="tab" onclick="adminTab('log', this)">اللوق الشامل</div>
            <div class="tab" onclick="adminTab('settings', this)">الإعدادات</div>
        </div>\` : '';
    document.getElementById('app').innerHTML = \`
        <div class="card row"><h2>\${ME.isSeniorAdmin ? 'لوحة تحكم كبار المسؤولين' : 'لوحة الإدارة'}</h2><button class="btn gray sm" onclick="renderDashboard()">رجوع للوحتي</button></div>
        \${tabsHtml}
        <div id="admin-content"></div>\`;
    adminTab('pending');
}
function adminTab(name, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    if (name === 'pending') loadPending();
    if (name === 'personnel') loadPersonnel();
    if (name === 'vehicles') loadVehicles();
    if (name === 'hire') loadHire();
    if (name === 'thresholds') loadThresholds();
    if (name === 'log') loadLog();
    if (name === 'settings') loadSettings();
}
async function loadPending() {
    const box = document.getElementById('admin-content');
    if (!box) return;
    if (!box.dataset.loaded) box.innerHTML = '<div class="card">جارِ التحميل...</div>';
    const { list } = await api('/api/admin/pending');
    box.id = 'admin-content'; box.dataset.loaded = '1';
    box.innerHTML = '<div id="pending-box"></div>';
    const pbox = document.getElementById('pending-box');
    if (list.length === 0) { pbox.innerHTML = '<div class="card center" style="color:var(--muted);">لا توجد مخالفات معلّقة</div>'; return; }
    pbox.innerHTML = list.map(v => \`
        <div class="card">
            <div class="row">
                <div class="row" style="gap:10px;">
                    \${v.photo ? \`<img class="thumb" src="\${v.photo}" onclick="window.open('\${v.photo}','_blank')">\` : ''}
                    <div>
                        <b>\${v.reporterName}</b> <span style="color:var(--muted);font-size:12px;">(\${v.reporterUnit})</span>
                        <div style="color:var(--gold-soft);margin-top:4px;">\${v.violationType}</div>
                        <div style="color:var(--muted);font-size:13px;">المركبة: \${v.vehicle} • اللوحة: \${v.plateNumber}</div>
                    </div>
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
let personnelCache = [];
async function searchPersonnel() {
    const q = document.getElementById('p-search') ? document.getElementById('p-search').value : '';
    const { list } = await api('/api/senior/personnel?q=' + encodeURIComponent(q));
    personnelCache = list;
    document.getElementById('p-list').innerHTML = list.map((p, i) => \`
        <div class="card" id="pcard-\${i}">
            <div class="row">
                <div>
                    <b>\${p.registeredName || p.discordTag}</b> <span style="color:var(--muted);font-size:12px;">\${p.unit || ''} • \${p.rank}</span>
                    <div style="font-size:13px;color:#94a3b8;">النقاط: \${p.points} \${p.isBlocked ? '• 🚫 موقوف' : ''}</div>
                </div>
                <div class="row" style="gap:6px;">
                    <button class="btn sm gray" onclick="toggleEdit(\${i})">تعديل</button>
                    <button class="btn sm gray" onclick="addNote('\${p.discord}')">ملاحظة</button>
                    <button class="btn sm \${p.isBlocked ? '' : 'danger'}" onclick="toggleBlock('\${p.discord}', \${!p.isBlocked})">\${p.isBlocked ? 'إلغاء الإيقاف' : 'إيقاف (بند)'}</button>
                </div>
            </div>
            <div id="pedit-\${i}" class="hidden" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
                <label>الاسم</label><input id="pe-name-\${i}" value="\${p.registeredName || ''}">
                <label>اليونت</label><input id="pe-unit-\${i}" value="\${p.unit || ''}">
                <label>الرتبة العسكرية</label>
                <select id="pe-rank-\${i}">\${MILITARY_RANKS.map(r => \`<option \${r === p.rank ? 'selected' : ''}>\${r}</option>\`).join('')}</select>
                <label>النقاط</label><input type="number" id="pe-points-\${i}" value="\${p.points}">
                <button class="btn sm" onclick="saveEdit('\${p.discord}', \${i})">حفظ التعديلات</button>
            </div>
        </div>\`).join('') || '<div class="card center" style="color:var(--muted);">لا نتائج</div>';
}
function toggleEdit(i) {
    document.getElementById('pedit-' + i).classList.toggle('hidden');
}
async function saveEdit(discordId, i) {
    const body = {
        name: document.getElementById('pe-name-' + i).value,
        unit: document.getElementById('pe-unit-' + i).value,
        rank: document.getElementById('pe-rank-' + i).value,
        points: document.getElementById('pe-points-' + i).value,
    };
    try {
        await api('/api/senior/personnel/' + discordId + '/update', { method: 'POST', body: JSON.stringify(body) });
        toast('✅ تم حفظ التعديلات');
        searchPersonnel();
    } catch (e) { toast(e.message); }
}
function addNote(discordId) {
    const text = prompt('اكتب الملاحظة:');
    if (!text || !text.trim()) return;
    api('/api/senior/personnel/' + discordId + '/note', { method: 'POST', body: JSON.stringify({ text }) })
        .then(() => toast('تمت الإضافة')).catch(e => toast(e.message));
}
function toggleBlock(discordId, blocked) {
    api('/api/senior/personnel/' + discordId + '/block', { method: 'POST', body: JSON.stringify({ blocked }) })
        .then(() => { toast('تم التحديث'); searchPersonnel(); }).catch(e => toast(e.message));
}
let newVehiclePhoto = null;
async function loadVehicles() {
    const box = document.getElementById('admin-content');
    box.innerHTML = \`
        <div class="card">
            <h3>إضافة مركبة</h3>
            <label>اسم المركبة</label>
            <input id="veh-name" placeholder="مثال: فورد F150">
            <label>صورة المركبة</label>
            <input type="file" id="veh-photo" accept="image/*" onchange="previewVehiclePhoto()">
            <img id="veh-photo-preview" style="display:none;max-width:160px;border-radius:8px;margin-bottom:10px;">
            <button class="btn sm" onclick="addVehicle()">إضافة</button>
        </div>
        <div id="veh-list" class="vgrid"></div>\`;
    loadVehicleList();
}
function previewVehiclePhoto() {
    const f = document.getElementById('veh-photo').files[0];
    if (!f) return;
    if (f.size > ${CONFIG.MAX_PHOTO_MB} * 1024 * 1024) { toast('الصورة أكبر من ${CONFIG.MAX_PHOTO_MB}MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        newVehiclePhoto = e.target.result;
        const img = document.getElementById('veh-photo-preview');
        img.src = newVehiclePhoto; img.style.display = 'block';
    };
    reader.readAsDataURL(f);
}
async function addVehicle() {
    const name = document.getElementById('veh-name').value.trim();
    if (!name) return toast('حط اسم المركبة');
    try {
        await api('/api/senior/vehicles', { method: 'POST', body: JSON.stringify({ name, photo: newVehiclePhoto }) });
        toast('تمت الإضافة'); newVehiclePhoto = null; loadVehicles();
    } catch (e) { toast(e.message); }
}
async function loadVehicleList() {
    const { list } = await api('/api/senior/vehicles');
    document.getElementById('veh-list').innerHTML = list.map(v => \`
        <div class="vcard">
            \${v.photo ? \`<img src="\${v.photo}">\` : ''}
            <div>\${v.name}</div>
            <button class="btn danger sm" style="margin-top:4px;padding:3px 8px;font-size:10px;" onclick="delVehicle('\${v._id}')">حذف</button>
        </div>\`).join('') || '<p style="color:var(--muted);">لا توجد مركبات</p>';
}
function delVehicle(id) {
    api('/api/senior/vehicles/' + id, { method: 'DELETE' }).then(() => { toast('تم الحذف'); loadVehicleList(); });
}
async function loadHire() {
    const box = document.getElementById('admin-content');
    box.innerHTML = \`
        <div class="card">
            <h3>توظيف إداري</h3>
            <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">الإداري المعيّن يقدر فقط يقبل أو يرفض المخالفات المعلّقة.</p>
            <label>آيدي الإداري (Discord ID)</label>
            <input id="hire-id" placeholder="مثال: 123456789012345678">
            <label>اسمه</label>
            <input id="hire-name" placeholder="اسم الإداري">
            <button class="btn sm" onclick="hireAdmin()">تم</button>
        </div>
        <div id="admins-list"></div>\`;
    loadAdminsList();
}
async function hireAdmin() {
    const discordId = document.getElementById('hire-id').value.trim();
    const name = document.getElementById('hire-name').value.trim();
    if (!discordId) return toast('حط آيدي الإداري');
    try { await api('/api/senior/hire-admin', { method: 'POST', body: JSON.stringify({ discordId, name }) }); toast('تم التعيين'); loadHire(); }
    catch (e) { toast(e.message); }
}
async function loadAdminsList() {
    const { list } = await api('/api/senior/admins');
    document.getElementById('admins-list').innerHTML = list.map(id => \`
        <div class="card row"><span>\${id}</span><button class="btn danger sm" onclick="fireAdmin('\${id}')">فصل</button></div>\`).join('') || '<div class="card center" style="color:var(--muted);">لا يوجد إداريون معيّنون</div>';
}
function fireAdmin(id) {
    api('/api/senior/fire-admin', { method: 'POST', body: JSON.stringify({ discordId: id }) }).then(() => { toast('تم الفصل'); loadHire(); });
}
async function loadThresholds() {
    const { ranks, thresholds } = await api('/api/senior/thresholds');
    const box = document.getElementById('admin-content');
    box.innerHTML = \`<div class="card">
        <h3>نقاط الترقية بين الرتب</h3>
        <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">حدد كم نقطة يحتاجها العسكري بكل رتبة عشان يترقى للي بعدها.</p>
        \${ranks.map((r, i) => i === ranks.length - 1 ? '' : \`
            <div class="row" style="margin-bottom:8px;">
                <span style="font-size:13px;">\${r} ——> \${ranks[i+1]}</span>
                <input type="number" style="width:100px;margin-bottom:0;" id="th-\${i}" value="\${thresholds[r]}">
            </div>\`).join('')}
        <button class="btn sm" onclick="saveThresholds()" style="margin-top:8px;">حفظ</button>
    </div>\`;
    box.dataset.ranks = JSON.stringify(ranks);
}
async function saveThresholds() {
    const ranks = JSON.parse(document.getElementById('admin-content').dataset.ranks);
    const thresholds = {};
    ranks.forEach((r, i) => { const el = document.getElementById('th-' + i); if (el) thresholds[r] = parseInt(el.value) || 0; });
    try { await api('/api/senior/thresholds', { method: 'POST', body: JSON.stringify({ thresholds }) }); toast('تم الحفظ'); }
    catch (e) { toast(e.message); }
}
async function loadLog() {
    const { list } = await api('/api/senior/log');
    document.getElementById('admin-content').innerHTML = \`<div class="card"><table>
        <tr><th>الوقت</th><th>مين</th><th>الإجراء</th><th>التفاصيل</th></tr>
        \${list.map(l => \`<tr><td style="font-size:11px;">\${new Date(l.createdAt).toLocaleString('ar')}</td><td>\${l.actorTag || l.actorId}</td><td>\${l.action}</td><td style="font-size:12px;">\${l.detail || ''}</td></tr>\`).join('')}
    </table></div>\` || '<div class="card center" style="color:var(--muted);">لا يوجد سجل بعد</div>';
}
async function loadSettings() {
    const { settings } = await api('/api/senior/settings');
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
    try { await api('/api/senior/settings', { method: 'POST', body: JSON.stringify(body) }); toast('تم الحفظ'); }
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
