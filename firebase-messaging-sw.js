self.addEventListener("push", function (event) {

    let payload = {};

    try {

        payload = event.data ? event.data.json() : {};

    } catch (err) {

        payload = {

            notification: {

                title: "Smart Flood Sentinel Alert",

                body: event.data ? event.data.text() : "Flood alert received."

            }

        };

    }

    const title =

        payload.notification?.title ||

        payload.data?.title ||

        "Smart Flood Sentinel Alert";

    const options = {

        body:

            payload.notification?.body ||

            payload.data?.body ||

            "Flood alert received.",

        icon: "/icon.png",

        badge: "/icon.png",

        data: payload.data || {}

    };

    event.waitUntil(

        self.registration.showNotification(title, options)

    );

});

self.addEventListener("notificationclick", function (event) {

    event.notification.close();

    event.waitUntil(

        clients.openWindow("/")

    );

});
