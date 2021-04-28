import * as functions from "firebase-functions";
import { User } from "./types/user";
import admin = require("firebase-admin");
import { Shop } from "./types/shop";
import { Review } from "./types/review";
import algoliasearch from "algoliasearch";
import { Expo, ExpoPushMessage } from "expo-server-sdk";

const ALOGOLIA_ID = functions.config().algolia.id;
const ALOGOLIA_ADMIN_KEY = functions.config().algolia.key;
const client = algoliasearch(ALOGOLIA_ID, ALOGOLIA_ADMIN_KEY);
const index = client.initIndex("reviews");

//firebaseのアプリを初期化
admin.initializeApp();
let expo = new Expo();
exports.onUpdateUser = functions
  .region("asia-northeast1")
  .firestore.document("users/{userId}")
  .onUpdate(async (change, context) => {
    const { userId } = context.params;
    const newUser = change.after.data() as User;

    const db = admin.firestore();
    try {
      const snapshot = await db
        .collectionGroup("reviews")
        .where("user.id", "==", userId)
        .get();

      const batch = db.batch();
      snapshot.docs.forEach((reviewDoc) => {
        const user = { ...reviewDoc.data().user, name: newUser.name };
        batch.update(reviewDoc.ref, { user });
      });
      await batch.commit();
    } catch (err) {
      console.log(err);
    }
  });

exports.onWriteReview = functions
  .region("asia-northeast1")
  .firestore.document("shops/{shopId}/reviews/{reviewId}")
  .onWrite(async (change, context) => {
    const { shopId, reviewId } = context.params;
    const review = change.after.data() as Review;
    const db = admin.firestore();
    try {
      const shopRef = db.collection("shops").doc(shopId);
      const shopDoc = await shopRef.get();
      const shop = shopDoc.data() as Shop;

      //平均scoreの計算

      let { score1 = 0, score2 = 0, score3 = 0, score4 = 0, score5 = 0 } = shop;

      if (review.score === 1) {
        score1 += 1;
      } else if (review.score === 2) {
        score2 += 1;
      } else if (review.score === 3) {
        score3 += 1;
      } else if (review.score === 4) {
        score4 += 1;
      } else if (review.score === 5) {
        score5 += 1;
      }
      let aveScore =
        (score1 + score2 * 2 + score3 * 3 + score4 + 4 + score5 * 5) /
        (score1 + score2 + score3 + score4 + score5);
      aveScore = Math.round(aveScore * 100) / 100;
      //shopの更新
      let params = {};
      if (review.score === 1) {
        params = {
          score1: admin.firestore.FieldValue.increment(1),
          score: aveScore,
        };
      } else if (review.score === 2) {
        params = {
          score2: admin.firestore.FieldValue.increment(2),
          score: aveScore,
        };
      } else if (review.score === 3) {
        params = {
          score3: admin.firestore.FieldValue.increment(3),
          score: aveScore,
        };
      } else if (review.score === 4) {
        params = {
          score4: admin.firestore.FieldValue.increment(4),
          score: aveScore,
        };
      } else if (review.score === 5) {
        params = {
          score5: admin.firestore.FieldValue.increment(5),
          score: aveScore,
        };
      }
      await shopRef.update(params);
      index.saveObject({
        objectID: reviewId,
        ...review,
      });
    } catch (err) {
      console.log(err);
    }
  });

exports.scheduledPushNotification = functions
  .region("asia-northeast1")
  .pubsub.schedule("0 10 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    // userからpushTokenを抽出
    const snapshot = await admin.firestore().collection("users").get();
    const pushTokens = snapshot.docs
      .map((doc) => (doc.data() as User).pushToken)
      .filter((pushToken) => !!pushToken);

    let messages: ExpoPushMessage[] = [];
    for (let pushToken of pushTokens) {
      if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`Push token ${pushToken} is not a valid Expo push token`);
        continue;
      }

      messages.push({
        to: pushToken,
        sound: "default",
        body: "週末に行ったレストランのレビューを書こう♪",
        data: { withSome: "data" },
      });
    }

    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];

    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error(error);
      }
    }
  });
