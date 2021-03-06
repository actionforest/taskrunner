/**
 * @file ActionRunner
 * @author Jim Bulkowski <jim.b@paperelectron.com>
 * @project taskrunner
 * @license MIT {@link http://opensource.org/licenses/MIT}
 */

/**
 * @file TaskReciever
 * @author Jim Bulkowski <jim.b@paperelectron.com>
 * @project taskrunner
 * @license MIT {@link http://opensource.org/licenses/MIT}
 */

import Bluebird from 'bluebird'
import {CreatePlugin} from "@pomegranate/plugin-tools";
import {isNull, isString, has, get} from 'lodash/fp'

let hasCorrelation = (stats) => {
  return has('callerMetadata.replyTo', stats) && has('callerMetadata.correlationId', stats)
}


export const ActionRunner = CreatePlugin('action')
  .configuration({
    name: 'ActionRunner',
    depends: ['@pomofficial/RabbitMQ', '@actionforest/ActionTree']
  })

  .variables({
    actionQueue: 'actionForest'
  })
  .hooks({
    load: async (PluginLateError,PluginStore, PluginVariables, PluginLogger, RabbitMQ, ActionTree, DispatchAction, ActionReply) => {
      let taskHooks = {
        requeue: (stats, requeueData) => {
          PluginLogger.log(`${stats.name}: ${stats.uuid} will requeue.`)
          return DispatchAction.to(PluginVariables.actionQueue).write(requeueData)
        },
        success: async (stats, requeueData) => {
          if(hasCorrelation(stats)){
            try {
              await ActionReply({
                rpc_auto_success: stats.state
              }, stats.callerMetadata)
            }
            catch(e){
              PluginLogger.error(e)
            }
          }

          PluginLogger.log(`${stats.name}: ${stats.uuid} complete`)

        },
        failure: async (stats, requeueData) => {
          if(hasCorrelation(stats)){
            try {
              await ActionReply({
                rpc_auto_failure: {message: stats.transitionError.message, stack: stats.transitionError.stack}
              }, stats.callerMetadata)
            }
            catch(e){
              PluginLogger.error(e)
            }
          }
          PluginLogger.error('error', stats.callerMetadata)
          PluginLogger.error(`${stats.name}: ${stats.uuid} permanently failed.`)
        }
      }

      ActionTree.registerTaskHooks(taskHooks)

      PluginStore.taskHandler = function(msg) {
        if(isNull(msg)){
          PluginLogger.warn('Message string was null, discarding')
          this.ack(msg)
        }

        let parsedMsg
        try {
          parsedMsg = JSON.parse(msg.content.toString())
          if(parsedMsg == null){
            throw new Error('Parsed Message was null.')
          }
          let correlationId = msg.properties.correlationId
          let replyTo = msg.properties.replyTo

          if(correlationId && replyTo){
            parsedMsg.RPCmetadata = {
              correlationId: correlationId,
              replyTo: replyTo
            }
          }
          if(parsedMsg.metadata){
            return ActionTree.runTask(parsedMsg, parsedMsg.RPCmetadata)
              .then((res) => {
                this.ack(msg)
              })
              .catch((error) => {
                PluginLogger.error(error)
                this.ack(msg)
              })
          } else {
            throw new Error('Message Did not contain a metadata property.')
          }

        }
        catch (e) {
          PluginLogger.warn(`Unable to handle message "${msg.content}", ${e.message}`);
          this.ack(msg)
          return
        }

        this.ack(msg)
      }

      let queueName = DispatchAction.to(PluginVariables.actionQueue).getQueueName()
      let taskChannel = await RabbitMQ.createChannel()

      taskChannel.on('error', (error) => {
        PluginLateError(error)
      })
      taskChannel.prefetch(1000)
      taskChannel.assertQueue(queueName, {durable: true})
      PluginStore.queueName = queueName
      PluginStore.taskChannel = taskChannel

      return null
    },
    start: (PluginLogger, PluginStore) => {
      PluginStore.taskChannel.consume(PluginStore.queueName, PluginStore.taskHandler.bind(PluginStore.taskChannel))
    },
    stop: (PluginStore, PluginLogger) => {
      if(PluginStore.taskChannel){
        return PluginStore.taskChannel.close().then(() => {
          PluginLogger.log('Closed RabbitMQ channel')
          return null
        })
      }
    }
  })

