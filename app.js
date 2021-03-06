// Author: Sherif Sarhan
// Date: 10/9/2017
// This loads the environment variables from the .env file
require("dotenv-extended").load();

const azure = require("botbuilder-azure");
const builder = require("botbuilder");
const restify = require("restify");
const spellService = require("./spell-service");
const FuzzySet = require("fuzzyset.js");
const Helpers = require("./helpers");
const helpers = new Helpers(builder);

// Set up Azure CosmosDB
const documentDbOptions = {
  host: process.env.AZURE_DOCUMENTDB_URI,
  masterKey: process.env.AZURE_DOCUMENTDB_KEY,
  database: "botdocs",
  collection: "botdata"
};

// Create instance of DocumentDbClient
const docDbClient = new azure.DocumentDbClient(documentDbOptions);
// Create instance of AzureBotStorage
const cosmosStorage = new azure.AzureBotStorage(
  { gzipData: false },
  docDbClient
);

// Setup Restify Server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, () => {
  console.log("%s listening to %s", server.name, server.url);
});
// Create connector and listen for messages
const connector = new builder.ChatConnector({
  appId: process.env.MICROSOFT_APP_ID,
  appPassword: process.env.MICROSOFT_APP_PASSWORD
});
// Periodically refresh the token
setInterval(() => {
  connector.getAccessToken(
    error => {
      console.log(JSON.stringify(error));
    },
    token => {
      console.log(`token refreshed: ${token}`);
    }
  );
}, 30 * 60 * 1000 /* 30 minutes in milliseconds */);
server.post("/api/messages", connector.listen());

const bot = new builder.UniversalBot(connector, session => {
  session.send(
    "Sorry, I did not understand '%s'." + "Type 'help' if you need assistance.",
    session.message.text
  );
}).set("storage", cosmosStorage);

// You can provide your own model by specifying
// the 'LUIS_MODEL_URL' environment variable
// This Url can be obtained by uploading or creating
// Your model from the LUIS portal: https://www.luis.ai/
const recognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL);
bot.recognizer(recognizer);

const dateOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
};
const dateOptionsShort = { weekday: "short", month: "short", day: "numeric" };
const dateOptionsShortWithTime = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
};
const timeOptionsShort = { hour: "2-digit", minute: "2-digit" };

Date.prototype.addDays = function(days) {
  const date = new Date(this.valueOf());
  date.setDate(date.getDate() + days);
  return date;
};

bot
  .dialog("scheduleAppointment", [
    function(session, args, next) {
      session.userData = {};
      // try extracting entities
      session.userData.doctorEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "DoctorType"
      );

      session.userData.dateEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "builtin.datetimeV2.date"
      );
      session.userData.timeEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "builtin.datetimeV2.time"
      );
      session.userData.dateTimeEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "builtin.datetimeV2.datetime"
      );
      session.userData.dateTimeRangeEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "builtin.datetimeV2.datetimerange"
      );
      session.userData.timeRangeEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "builtin.datetimeV2.timerange"
      );
      session.userData.dateRangeEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "builtin.datetimeV2.daterange"
      );

      session.userData.reasonEntity = builder.EntityRecognizer.findEntity(
        args.intent.entities,
        "AppointmentReason"
      );

      if (!session.userData.doctorEntity) {
        // doctor type entity is not detected, ask for it
        session.beginDialog("askDoctorType");
      } else {
        // doctor type entity is detected,
        // isolate doctor type through approximate matching
        const fuzzySet = new FuzzySet([
          "Radiologist",
          "Psychiatrist",
          "Cardiologist",
          "Dermatologist"
        ]);
        // check if doctor user entered is in available set
        if (
          !fuzzySet.get(session.userData.doctorEntity.entity) ||
          fuzzySet.get(session.userData.doctorEntity.entity)[0][0] < 0.5
        ) {
          // not in available set. ask for doctor type
          session.beginDialog("askDoctorType");
        }
        session.userData.doctorType = fuzzySet.get(
          session.userData.doctorEntity.entity
        )[0][1];
        next();
      }
    },
    function(session, args, next) {
      const dateEntity = session.userData.dateEntity;
      const timeEntity = session.userData.timeEntity;
      const dateTimeEntity = session.userData.dateTimeEntity;
      const dateTimeRangeEntity = session.userData.dateTimeRangeEntity;
      const timeRangeEntity = session.userData.timeRangeEntity;
      const dateRangeEntity = session.userData.dateRangeEntity;

      // if there is no date nor time ex. tomorrow 2pm
      // nor datetimerange
      if (
        !dateEntity &&
        !timeEntity &&
        !dateTimeEntity &&
        !dateTimeRangeEntity &&
        !timeRangeEntity &&
        !dateRangeEntity
      ) {
        // then open dialog asking for day/time
        session.beginDialog("askDayAndTime");
      }

      // if there's no time ex. 2pm
      // then display available times for that day
      if (dateEntity && !timeRangeEntity) {
        // then open dialog asking for time
        const reqDate = builder.EntityRecognizer.parseTime(dateEntity.entity);
        session.userData.requestedDate = reqDate;
        session.beginDialog("askTimeForGivenDay");
      }

      // if there is a given date, and a given time range
      if (dateEntity && timeRangeEntity) {
        // then open dialog asking for time
        const reqDate = builder.EntityRecognizer.parseTime(dateEntity.entity);
        session.userData.requestedDate = reqDate;

        // get the time ranges
        const timeRangeStart = timeRangeEntity.resolution.values[0].start;
        const timeRangeEnd = timeRangeEntity.resolution.values[0].end;
        helpers.handleDateRange(
          session,
          null,
          { start: timeRangeStart, end: timeRangeEnd },
          reqDate
        );
      }

      // if there's no day ex. tomorrow
      // open dialog asking what days for that time
      if (timeEntity && !dateRangeEntity) {
        // then open dialog asking for day
        const reqDate = builder.EntityRecognizer.parseTime(timeEntity.entity);
        session.userData.requestedDate = reqDate;
        // check if time is proper
        if (!helpers.isIncrementOfThirty(reqDate)) {
          session.userData.postProper = "askDayForGivenTime";
          session.beginDialog("askProperTime");
        } else {
          // ask for dayForTime
          session.beginDialog("askDayForGivenTime");
        }
      }

      // if there is a time with a date range (this week 2pm)
      if (timeEntity && dateRangeEntity) {
        // returns date object
        const reqDate = builder.EntityRecognizer.parseTime(timeEntity.entity);
        session.userData.requestedDate = reqDate;
        const funcHandler = function() {
          // clean the date ranges
          const dateRange = dateRangeEntity.resolution.values;
          const dateRangeClean = helpers.cleanDateRange(dateRange);
          helpers.handleDateRange(session, dateRangeClean, {
            start: timeEntity.entity,
            end: timeEntity.entity
          });
        };
        // check if time is proper
        if (!helpers.isIncrementOfThirty(reqDate)) {
          session.userData.postProperCallback = funcHandler;
          session.replaceDialog("askProperTime");
        }
        funcHandler();
      }

      // if there are both date & time
      // then use datetime entity and check if available
      if (dateTimeEntity) {
        // check if is/isn't available
        const reqDate = builder.EntityRecognizer.parseTime(
          dateTimeEntity.entity
        );
        session.userData.requestedDate = reqDate;

        // check if time is not proper
        if (!helpers.isIncrementOfThirty(reqDate)) {
          session.userData.postProper = "askTimeForGivenDay";
          session.userData.checkAvailable = true;
          session.beginDialog("askProperTime");
        } else {
          // check if date is/isn't available in doctor's calendar
          if (!helpers.isTimeslotAvailable(session, reqDate)) {
            // if not, try to find another time/day that works
            // since the requested time/date is not available
            session.beginDialog("askTimeForGivenDay", { unavail: true });
          } else {
            next();
          }
        }
      }

      // if there is a date and time range
      // then use datetimerange entity and check if available
      if (dateTimeRangeEntity) {
        const dateRange = dateTimeRangeEntity.resolution.values;
        const dateRangeClean = helpers.cleanDateRange(dateRange);
        helpers.handleDateTimeRange(session, dateRangeClean);
      }

      if (dateRangeEntity && timeRangeEntity) {
        // clean the date ranges
        const dateRange = dateRangeEntity.resolution.values;
        const dateRangeClean = helpers.cleanDateRange(dateRange);
        // get the time ranges
        const timeRangeStart = timeRangeEntity.resolution.values[0].start;
        const timeRangeEnd = timeRangeEntity.resolution.values[0].end;
        helpers.handleDateRange(session, dateRangeClean, {
          start: timeRangeStart,
          end: timeRangeEnd
        });
      }

      // if there is a time range detected
      if (timeRangeEntity && !dateEntity && !dateRangeEntity) {
        const timeRangeStart = timeRangeEntity.resolution.values[0].start;
        const timeRangeEnd = timeRangeEntity.resolution.values[0].end;
        session.beginDialog("askDayForGivenTime", {
          timeRange: { start: timeRangeStart, end: timeRangeEnd }
        });
      }

      // if there is a date range detected
      if (dateRangeEntity && !timeRangeEntity && !timeEntity) {
        // get date ranges not in the past
        const dateRange = dateRangeEntity.resolution.values;
        const dateRangeClean = helpers.cleanDateRange(dateRange);

        // now have a clean date range
        // find all available timeslots in that daterange
        helpers.handleDateRange(session, dateRangeClean);
      }
    },
    function(session, args, next) {
      if (!session.userData.reasonEntity) {
        // reason entity is not detected, continue to next step
        session.beginDialog("askReason");
      } else {
        session.userData.apptReason = session.userData.reasonEntity;
        next();
      }
    },
    function(session) {
      session.send(`Alright! Your appointment is scheduled with a\
     ${session.userData.doctorType} for \
     ${new Date(session.userData.requestedDate).toLocaleDateString(
       "en-US",
       dateOptions
     )} \
        for the reason: ${session.userData.apptReason.entity}`);
      session.send("Thanks!");
    }
  ])
  .triggerAction({
    matches: "ScheduleAppointment",
    intentThreshold: 0.79
  });

bot.dialog("askDoctorType", [
  function(session, args) {
    builder.Prompts.choice(
      session,
      "What type of doctor you would like to see?",
      ["Radiologist", "Psychiatrist", "Cardiologist", "Dermatologist"],
      { listStyle: builder.ListStyle.button }
    );
  },
  function(session, args) {
    const doctorType = args.response.entity;
    if (!doctorType) session.replaceDialog("askDoctorType", { reprompt: true });
    else {
      session.userData.doctorType = doctorType;
      session.endDialog();
    }
  }
]);

bot.dialog("askDayAndTime", [
  function(session, args) {
    if (args && args.pastDate) {
      session.send("The date cannot be in the past");
    }
    builder.Prompts.text(
      session,
      "Please enter a day, a time, both, or a date and time range"
    );
  },
  function(session, args) {
    // recognize entity check if received date, time, both or neither
    builder.LuisRecognizer.recognize(
      args.response,
      process.env.LUIS_MODEL_URL,
      (err, intents, entities) => {
        if (err) console.log(err.stack);
        if (entities) {
          // only one of these will be not null
          let dateTimeEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.datetime"
          );
          let dateEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.date"
          );
          let timeEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.time"
          );
          let dateTimeRangeEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.datetimerange"
          );
          let timeRangeEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.timerange"
          );
          let dateRangeEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.daterange"
          );

          if (
            !dateTimeEntity &&
            !dateEntity &&
            !timeEntity &&
            !dateTimeRangeEntity &&
            !timeRangeEntity &&
            !dateRangeEntity
          ) {
            session.replaceDialog("askDayAndTime", { reprompt: true });
          }

          // do something with entity...

          if (dateTimeEntity) {
            // returns date object
            let reqDate = new Date(dateTimeEntity.resolution.values[0].value);
            session.userData.requestedDate = reqDate;
            // check if time is not proper
            if (!helpers.isIncrementOfThirty(reqDate)) {
              session.userData.postProper = "askTimeForGivenDay";
              session.replaceDialog("askProperTime");
            } else {
              // check if date is/isn't available in doctor's calendar
              if (!helpers.isTimeslotAvailable(session, reqDate)) {
                // if not, try to find another time/day that works
                // since the requested time/date is not available
                session.replaceDialog("askTimeForGivenDay", { unavail: true });
              } else {
                session.endDialog();
              }
            }
          }
          if (dateEntity && !timeRangeEntity) {
            // ensure date not in past
            let cleanDate = helpers.cleanDateRange(
              dateEntity.resolution.values
            );
            // returns date object
            let reqDate = new Date(cleanDate[0].value);
            session.userData.requestedDate = reqDate;
            // ask for timeForDay
            session.replaceDialog("askTimeForGivenDay");
          }
          // if there is only a given time
          if (timeEntity && !dateRangeEntity) {
            // returns date object
            let reqDate = builder.EntityRecognizer.parseTime(timeEntity.entity);
            session.userData.requestedDate = reqDate;
            // check if time is proper
            if (!helpers.isIncrementOfThirty(reqDate)) {
              session.userData.postProper = "askDayForGivenTime";
              session.replaceDialog("askProperTime");
            } else {
              // ask for dayForTime
              session.replaceDialog("askDayForGivenTime");
            }
          }
          // if there is a time with a date range (this week 2pm)
          if (timeEntity && dateRangeEntity) {
            // returns date object
            let reqDate = builder.EntityRecognizer.parseTime(timeEntity.entity);
            session.userData.requestedDate = reqDate;
            const funcHandler = function() {
              // clean the date ranges
              let dateRange = dateRangeEntity.resolution.values;
              let dateRangeClean = helpers.cleanDateRange(dateRange);
              helpers.handleDateRange(session, dateRangeClean, {
                start: timeEntity.entity,
                end: timeEntity.entity
              });
            };
            // check if time is proper
            if (!helpers.isIncrementOfThirty(reqDate)) {
              session.userData.postProperCallback = funcHandler;
              session.replaceDialog("askProperTime");
            }
            funcHandler();
          }

          // if there is a given date, and a given time range
          if (dateEntity && timeRangeEntity) {
            // then open dialog asking for time
            let reqDate = builder.EntityRecognizer.parseTime(dateEntity.entity);
            session.userData.requestedDate = reqDate;
            // get the time ranges
            let timeRangeStart = timeRangeEntity.resolution.values[0].start;
            let timeRangeEnd = timeRangeEntity.resolution.values[0].end;
            helpers.handleDateRange(
              session,
              null,
              { start: timeRangeStart, end: timeRangeEnd },
              reqDate
            );
          }

          if (dateTimeRangeEntity) {
            let dateRange = dateTimeRangeEntity.resolution.values;
            let dateRangeClean = helpers.cleanDateRange(dateRange);
            helpers.handleDateTimeRange(session, dateRangeClean);
          }

          if (dateRangeEntity && timeRangeEntity) {
            // clean the date ranges
            let dateRange = dateRangeEntity.resolution.values;
            let dateRangeClean = helpers.cleanDateRange(dateRange);
            // get the time ranges
            let timeRangeStart = timeRangeEntity.resolution.values[0].start;
            let timeRangeEnd = timeRangeEntity.resolution.values[0].end;
            helpers.handleDateRange(session, dateRangeClean, {
              start: timeRangeStart,
              end: timeRangeEnd
            });
          }

          // if there is a time range detected
          if (timeRangeEntity && !dateEntity && !dateRangeEntity) {
            let timeRangeStart = timeRangeEntity.resolution.values[0].start;
            let timeRangeEnd = timeRangeEntity.resolution.values[0].end;
            session.beginDialog("askDayForGivenTime", {
              timeRange: { start: timeRangeStart, end: timeRangeEnd }
            });
          }

          // if there is a date range detected
          if (dateRangeEntity && !timeRangeEntity && !timeEntity) {
            // get date ranges not in the past
            let dateRange = dateRangeEntity.resolution.values;
            let dateRangeClean = helpers.cleanDateRange(dateRange);

            // now have a clean date range
            // find all available timeslots in that daterange
            helpers.handleDateRange(session, dateRangeClean);
          }
        }
      }
    );
  }
]);

bot.dialog("askProperTime", [
  function(session, args) {
    builder.Prompts.time(
      session,
      "Please provide increments of 30 minutes only. " +
        "(Examples: 1:30PM, 2:00PM, 2:30PM"
    );
  },
  function(session, args) {
    const time = args.response.entity;
    if (!time) session.replaceDialog("askProperTime", { reprompt: true });

    // recognize entity check if actually received time
    builder.LuisRecognizer.recognize(
      time,
      process.env.LUIS_MODEL_URL,
      (err, intents, entities) => {
        if (err) console.log(err.stack);
        if (entities) {
          const timeEntity = builder.EntityRecognizer.findEntity(
            entities,
            "builtin.datetimeV2.time"
          );
          // do something with entity...

          // returns date object
          const reqDate = builder.EntityRecognizer.parseTime(time);
          if (!timeEntity || !helpers.isIncrementOfThirty(reqDate)) {
            session.replaceDialog("askProperTime");
          } else {
            session.userData.requestedDate = new Date(
              session.userData.requestedDate
            );
            session.userData.requestedDate.setTime(reqDate.getTime());
            if (session.userData.checkAvailable) {
              if (helpers.isTimeslotAvailable(session, reqDate)) {
                session.endDialog();
              } else {
                session.replaceDialog(session.userData.postProper, {
                  unavail: true
                });
              }
            } else if (session.userData.postProper) {
              session.replaceDialog(session.userData.postProper);
            }
            if (session.userData.postProperCallback) {
              session.userData.postProperCallback();
            }
          }
        }
      }
    );
  }
]);

bot.dialog("askTimeForGivenDay", [
  function(session, args, next) {
    session.userData.availableTimeslots =
      args && args.avail
        ? session.userData.availableTimeslots
        : helpers.getAvailableTimeslots(session);
    let timeslotStrings = [];
    if (args && args.dateRange) {
      session.userData.availableTimeslots.forEach(timeslot =>
        timeslotStrings.push(
          timeslot.toLocaleTimeString("en-US", dateOptionsShortWithTime)
        )
      );
    } else {
      session.userData.availableTimeslots.forEach(timeslot =>
        timeslotStrings.push(
          timeslot.toLocaleTimeString("en-US", timeOptionsShort)
        )
      );
    }
    if (timeslotStrings.length > 10)
      timeslotStrings = timeslotStrings.slice(0, 11);
    timeslotStrings.push("Pick a different time/day");

    if (timeslotStrings.length === 1) {
      session.send("Sorry, there aren't any available for that.");
      session.userData.replaceDialog = "askDayAndTime";
      next();
    } else {
      if (args) {
        if (args.reprompt) {
          session.send("Please choose from the available options");
        }
        if (args.unavail) {
          session.send(
            "Sorry, that timeslot is booked. However, here are some other times for this day."
          );
          timeslotStrings.push(
            `View days with ${session.userData.requestedDate.toLocaleTimeString(
              "en-US",
              timeOptionsShort
            )} available`
          );
        }
      }
      builder.Prompts.choice(
        session,
        "Which one of these times would you prefer?",
        timeslotStrings,
        { listStyle: builder.ListStyle.button }
      );
    }
  },
  function(session, args) {
    if (session.userData.replaceDialog) {
      session.replaceDialog(session.userData.replaceDialog);
      delete session.userData.replaceDialog;
    } else {
      if (!args.response.entity) {
        session.replaceDialog("askTimeForGivenDay", { reprompt: true });
      }
      if (args.response.entity === "Pick a different time/day") {
        session.replaceDialog("askDayAndTime");
      } else if (
        args.response.entity ===
        `View days with ${new Date(
          session.userData.requestedDate
        ).toLocaleTimeString("en-US", timeOptionsShort)} available`
      ) {
        session.replaceDialog("askDayForGivenTime");
      } else {
        // mark it as booked
        const exactTime = new Date(
          session.userData.availableTimeslots[args.response.index]
        );
        session.userData.requestedDate = exactTime;

        session.endDialog();
      }
    }
  }
]);

bot.dialog("askDayForGivenTime", [
  function(session, args) {
    let dayStrings = [];
    let timeslotString;
    let dynamicDateOptions;
    if (args && args.timeRange) {
      // get array of dates that are in between time range
      session.userData.availableDays = helpers.getAvailableDays(
        session,
        args.timeRange
      );
      dynamicDateOptions = dateOptionsShortWithTime;
      timeslotString = `${builder.EntityRecognizer.parseTime(
        args.timeRange.start
      ).toLocaleTimeString("en-US", timeOptionsShort)} - 
            ${builder.EntityRecognizer.parseTime(
              args.timeRange.end
            ).toLocaleTimeString("en-US", timeOptionsShort)}`;
    } else {
      // get array of dates which have hour & minute available
      session.userData.availableDays = helpers.getAvailableDays(session);
      dynamicDateOptions = dateOptionsShort;
      session.userData.requestedDate =
        session.userData.requestedDate instanceof Date
          ? session.userData.requestedDate
          : new Date(session.userData.requestedDate);
      timeslotString = session.userData.requestedDate.toLocaleTimeString(
        "en-US",
        timeOptionsShort
      );
    }
    session.userData.availableDays.forEach(day =>
      dayStrings.push(day.toLocaleDateString("en-US", dynamicDateOptions))
    );
    if (dayStrings.length > 3) dayStrings = dayStrings.slice(0, 4);

    dayStrings.push("Pick a different time or day");
    if (dayStrings.length === 1) {
      // no available days for that time
      // ask for different time
      session.send(
        "Sorry, there are no available days with this time. Please pick a different date/time."
      );
      session.replaceDialog("askDayAndTime");
    } else {
      builder.Prompts.choice(
        session,
        `Here are the days with a ${timeslotString} timeslot available`,
        dayStrings,
        { listStyle: builder.ListStyle.button }
      );
    }
  },
  function(session, args) {
    if (!args.response.entity) {
      session.replaceDialog("askDayForGivenTime", { reprompt: true });
    } else if (args.response.entity === "Pick a different time or day") {
      session.replaceDialog("askDayAndTime");
    } else {
      const storedDate = new Date(session.userData.requestedDate);
      storedDate.setDate(
        new Date(
          session.userData.availableDays[args.response.index]
        ).getUTCDate()
      );
      session.userData.requestedDate = storedDate;
      session.endDialog();
    }
  }
]);

bot.dialog("askReason", [
  function(session) {
    builder.Prompts.text(session, "What is the reason for the appointment?");
  },
  function(session, results) {
    session.userData.apptReason = {};
    session.userData.apptReason.entity = results.response;
    session.endDialog();
  }
]);

bot
  .dialog("Help", session => {
    session.endDialog(
      "Hi! Try asking me things like: \n\n " +
        "'Schedule an appointment' \n\n " +
        "I need to see a radiologist' \n\n" +
        "'I need to see a psychiatrist tomorrow between 2pm and 4pm' \n\n " +
        "'Schedule me with a dermatologist this week at 1:30pm' \n\n " +
        "'I want an appointment between october 30th and november 4th from 9am to 11:30am'"
    );
  })
  .triggerAction({
    matches: ["Hello", "Help"],
    intentThreshold: 0.9
  });

bot
  .dialog("Cancel", session => {
    session.endDialog("Appointment scheduling canceled.");
  })
  .triggerAction({
    matches: "Cancel",
    intentThreshold: 0.65
  });

// Spell Check
if (process.env.IS_SPELL_CORRECTION_ENABLED === "true") {
  bot.use({
    botbuilder(session, next) {
      spellService
        .getCorrectedText(session.message.text)
        .then(text => {
          session.message.text = text;
          next();
        })
        .catch(error => {
          console.error(error);
          next();
        });
    }
  });
}
